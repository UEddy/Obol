"""Obol: invoices and payment links for Hermes Agent, backed by Stripe.

Surfaces registered here:
* seven ``obol_*`` tools (create, send, get, list, remind, void, and draft-from-message);
* a ``pre_tool_call`` hook that routes every money-touching call through Hermes's approval gate;
* the ``/invoices`` slash command (CLI, TUI, Desktop and every messaging platform);
* the ``hermes obol`` CLI (doctor, sync, ledger);
* an "overdue invoice chase" automation blueprint and a bundled ``obol:invoicing`` skill.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

from . import schemas
from .src.obol_lib import gate as gate_policy
from .src.obol_lib import guard, intake, money, risk, runtime, service
from .src.obol_lib.service import ValidationError
from .src.obol_lib.stripe_client import StripeError, key_mode

logger = logging.getLogger(__name__)

_PLUGIN_DIR = Path(__file__).resolve().parent


def _result(data: dict) -> str:
    from tools.registry import tool_result
    return tool_result(data)


def _error(message: str, **extra: Any) -> str:
    from tools.registry import tool_error
    return tool_error(message, **extra)


def _run(op: Callable[[dict], dict], args: dict) -> str:
    """Execute one operation and always return JSON: handlers must never raise into the agent loop."""
    try:
        return _result(op(args if isinstance(args, dict) else {}))
    except ValidationError as exc:
        return _error(str(exc), kind="invalid_arguments")
    except money.MoneyError as exc:
        return _error(str(exc), kind="invalid_amount")
    except LlmUnavailable as exc:
        return _error(f"{exc} Ask the user for the client, amount and email instead.", kind="llm_unavailable")
    except StripeError as exc:
        details = exc.as_dict()
        return _error(details.pop("error"), **details)
    except Exception as exc:  # last line of defence; logged with traceback, short message to the model
        logger.exception("obol: unexpected error")
        return _error(f"Obol hit an unexpected error ({exc.__class__.__name__}). Nothing further was sent.",
                      kind="internal")


# -- approval gate ------------------------------------------------------------------------------
def _unattended(ctx: Any) -> bool:
    current = getattr(ctx, "current_cron_execution", None)
    try:
        return current is not None and current() is not None
    except Exception:
        return True  # cannot tell: treat as unattended (fail closed)


def _make_gate(ctx: Any) -> Callable[..., Any]:
    def gate(tool_name: str = "", args: dict | None = None, **kwargs: Any):
        if tool_name not in gate_policy.WRITE_TOOLS:
            return _guard_gate(ctx, tool_name, args if isinstance(args, dict) else {}, kwargs)
        args = args if isinstance(args, dict) else {}
        try:
            settings = runtime.settings_from(ctx.get_config)
            mode = key_mode(runtime.api_key())

            def summary() -> str:
                if tool_name == "obol_create_invoice":
                    return gate_policy.describe_create(args, settings.default_currency)
                inv_id = str(args.get("invoice_id"))
                return gate_policy.describe_existing(tool_name, inv_id, runtime.store().get(inv_id))

            unattended = _unattended(ctx)
            directive = gate_policy.decide(tool_name, args, mode=mode, allow_live=settings.allow_live,
                                           unattended=unattended, summary=summary,
                                           assess=lambda: _assess(ctx, settings, tool_name, args))
            if directive and directive.get("action") == "block":
                check = "unattended_write" if unattended else "live_key"
                runtime.store().record_security(check, "high", "blocked", f"{tool_name}: {directive['message']}")
            return directive
        except Exception:
            logger.exception("obol: approval gate failed; blocking the call")
            return {"action": "block", "message": f"Obol could not check {tool_name} safely, so nothing was sent."}
    return gate


# -- Obol Guard: other plugins' money tools (opt-in) ----------------------------------------------
def _session_key(kwargs: dict) -> str:
    return str(kwargs.get("session_id") or kwargs.get("task_id") or "")


def _guard_settings(ctx: Any) -> service.Settings | None:
    try:
        settings = runtime.settings_from(ctx.get_config)
    except Exception:
        return None
    return settings if settings.guard_tools else None


def _guard_gate(ctx: Any, tool_name: str, args: dict, kwargs: dict) -> Any:
    settings = _guard_settings(ctx)
    if settings is None or not guard.matches(tool_name, settings.guard_tools):
        return None
    try:
        store = runtime.store()
        info = guard.extract(args)
        if _unattended(ctx):
            msg = (f"Obol Guard refused {tool_name}: this is an unattended run (cron) and a guarded money tool needs "
                   "a person to approve it. Nothing was sent.")
            store.record_security("guard_unattended", "high", "blocked", msg, ref=guard.new_ref(tool_name))
            return {"action": "block", "message": msg}
        history = store.guard_history(tool_name)
        flags = list(store.guard_context(_session_key(kwargs)))
        flags += guard.scan_context([("this call's arguments", guard.history_text(args))])
        flags += guard.amount_findings(info["amount"], [h["amount"] for h in history if h["amount"] is not None],
                                       settings.guard_amount_multiplier, settings.guard_min_history)
        flags += guard.recipient_findings(info["recipient"], [h["recipient"] for h in history])
        flags = _dedupe(flags)
        ref = guard.new_ref(tool_name)
        store.log("guard_prompted", None, f"{tool_name}: {info['amount']} {info['token'] or ''} to {info['recipient']}".strip())
        for f in flags:
            store.record_security(f["check"], f["severity"], "flagged", f"{tool_name}: {f['message']}", ref=ref)
        message = f"{guard.describe(tool_name, info)}.\n{gate_policy.format_flags(flags)}"
        return {"action": "approve", "message": message, "rule_key": f"obol:guard:{ref}"}
    except Exception:
        logger.exception("obol: Guard failed; blocking the guarded call")
        return {"action": "block", "message": f"Obol Guard could not check {tool_name} safely, so it was not run."}


def _dedupe(flags: list[dict]) -> list[dict]:
    seen, out = set(), []
    for f in flags:
        key = (f.get("check"), f.get("message"))
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def _make_guard_observers(ctx: Any) -> tuple[Callable[..., Any], Callable[..., Any]]:
    def after_tool(tool_name: str = "", args: dict | None = None, result: Any = None, status: str = "", **kwargs: Any):
        settings = _guard_settings(ctx)
        if settings is None or not tool_name or tool_name.startswith("obol_"):
            return None
        try:
            store = runtime.store()
            if guard.matches(tool_name, settings.guard_tools):
                if status in ("ok", "", None):
                    info = guard.extract(args if isinstance(args, dict) else {})
                    store.add_guard_spend(tool_name, info["amount"], info["token"], info["recipient"])
                    store.log("guard_spent", None, f"{tool_name}: {info['amount']} {info['token'] or ''} to {info['recipient']}".strip())
                return None
            # Any other tool's output (a fetched page, an email, a file) is context a later spend may act on.
            store.add_guard_context(_session_key(kwargs), guard.scan_context([(f"output of {tool_name}", guard.history_text(result))]))
        except Exception:
            logger.exception("obol: Guard post_tool_call observer failed")
        return None

    def before_turn(user_message: str = "", conversation_history: list | None = None, **kwargs: Any):
        if _guard_settings(ctx) is None:
            return None
        try:
            texts = [("your message", user_message or "")]
            for m in (conversation_history or [])[-8:]:
                if isinstance(m, dict) and isinstance(m.get("content"), str):
                    texts.append((f"earlier {m.get('role', 'message')}", m["content"]))
            runtime.store().add_guard_context(_session_key(kwargs), guard.scan_context(texts))
        except Exception:
            logger.exception("obol: Guard pre_llm_call observer failed")
        return None  # observer only: never injects context or blocks the turn

    return after_tool, before_turn


def _assess(ctx: Any, settings: service.Settings, tool_name: str, args: dict) -> list[dict]:
    """Run the risk checks for one write. Network calls use a short timeout and no retries."""
    if tool_name == "obol_void_invoice":
        return []  # cancelling cannot bill anyone
    store = runtime.store()
    try:
        client = runtime.make_client(settings, timeout=5.0, max_retries=0)
    except StripeError:
        client = None
    try:
        if tool_name == "obol_create_invoice":
            cur = str(args.get("currency") or settings.default_currency).lower()
            try:
                amount = sum(money.to_minor(i.get("amount"), cur) * int(i.get("quantity", 1) or 1)
                             for i in args.get("line_items") or [])
            except (money.MoneyError, TypeError, ValueError, AttributeError):
                amount = None
            flags = risk.assess(store, settings, customer_email=args.get("customer_email"),
                                customer_name=args.get("customer_name"), amount_minor=amount, currency=cur, client=client)
            fp = risk.create_fingerprint(args, settings.default_currency)
            if fp:
                store.stash_pending_risk(fp, flags)
            _record_flags(store, tool_name, flags, ref=fp)
            return flags
        inv_id = service.invoice_id(args.get("invoice_id"))
        row = store.get(inv_id)
        if row is None and client is not None:
            store.upsert([client.get_invoice(inv_id)])
            row = store.get(inv_id)
        if row is None:
            return [risk.flag("unavailable", "info", f"Invoice {inv_id} is not in Obol's cache; checks skipped.")]
        flags = risk.assess(store, settings, customer_email=row.get("customer_email"),
                            customer_name=row.get("customer_name"), amount_minor=row["amount_due"],
                            currency=row["currency"], client=client, exclude_invoice_id=inv_id)
        store.set_risk(inv_id, flags)
        _record_flags(store, tool_name, flags, invoice_id=inv_id)
        return flags
    finally:
        if client is not None:
            client.close()


# -- tools --------------------------------------------------------------------------------------
SECURITY_CHECKS = frozenset({"prompt_injection", "lookalike_domain", "impersonation", "contact_change", "duplicate",
                             "unusual_amount"})


def _record_flags(store: Any, tool_name: str, flags: list[dict], *, invoice_id: str | None = None,
                  ref: str | None = None) -> None:
    for f in flags:
        if f.get("check") in SECURITY_CHECKS and f.get("severity") in ("high", "medium"):
            store.record_security(f["check"], f["severity"], "flagged", f"{tool_name}: {f.get('message', '')}",
                                  invoice_id=invoice_id, ref=ref)


def _create_with_risk(client: Any, store: Any, settings: service.Settings, args: dict) -> dict:
    """Create the invoice, then attach the findings the approval hook showed for this exact call."""
    result = service.create_invoice(client, store, settings, args)
    fp = risk.create_fingerprint(args, settings.default_currency)
    flags = store.pop_pending_risk(fp) if fp else None
    if fp:
        store.link_security_ref(fp, result["invoice"]["invoice_id"])
    if flags is not None:
        store.set_risk(result["invoice"]["invoice_id"], flags)
        result["risk_flags"] = flags
    return result


def _tool_handlers(ctx: Any) -> dict[str, Callable[..., str]]:
    def settings() -> service.Settings:
        return runtime.settings_from(ctx.get_config)

    def with_client(fn: Callable[..., dict]) -> Callable[[dict], dict]:
        def op(args: dict) -> dict:
            st = settings()
            with runtime.make_client(st) as client:
                return fn(client, runtime.store(), st, args)
        return op

    ops: dict[str, Callable[[dict], dict]] = {
        "obol_create_invoice": with_client(_create_with_risk),
        "obol_send_invoice": with_client(lambda c, s, st, a: service.send_invoice(c, s, a)),
        "obol_get_invoice": with_client(lambda c, s, st, a: service.get_invoice(c, s, a)),
        "obol_list_invoices": with_client(lambda c, s, st, a: service.list_invoices(c, s, a)),
        "obol_send_reminder": with_client(lambda c, s, st, a: service.send_reminder(c, s, a)),
        "obol_void_invoice": with_client(lambda c, s, st, a: service.void_invoice(c, s, a)),
    }

    def draft_from_message(args: dict) -> dict:
        return intake.draft_from_message(_llm_extractor(ctx), runtime.store(), settings(), args)

    ops["obol_draft_from_message"] = draft_from_message

    def bind(op: Callable[[dict], dict]) -> Callable[..., str]:
        def handler(args: dict, **kwargs: Any) -> str:
            return _run(op, args)
        return handler

    return {name: bind(op) for name, op in ops.items()}


class LlmUnavailable(Exception):
    pass


_TRANSIENT = ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "overloaded", "high demand", "Timeout", "timed out")


def _llm_extractor(ctx: Any, sleep: Callable[[float], None] | None = None) -> Callable[[str, str], Any]:
    """Structured extraction through Hermes's own model and credentials (ctx.llm).

    Retries once on transient provider errors (overload, rate limit, timeout), and accepts JSON the
    model returned as plain text (including inside a code fence) when structured output wasn't honoured.
    """
    import time as _time
    pause = sleep or _time.sleep

    def extract(instructions: str, text: str) -> Any:
        llm = getattr(ctx, "llm", None)
        if llm is None:
            raise LlmUnavailable("This Hermes has no plugin LLM access (ctx.llm).")
        last: Exception | None = None
        for attempt in range(2):
            try:
                result = llm.complete_structured(
                    instructions=instructions, input=[{"type": "text", "text": text}], json_schema=intake.SCHEMA,
                    schema_name="obol.invoice_intake", purpose="obol.intake", temperature=0.0, max_tokens=4000,
                    timeout=60)
            except Exception as exc:
                last = exc
                if attempt == 0 and any(t.lower() in str(exc).lower() for t in _TRANSIENT):
                    pause(3.0)
                    continue
                break
            if getattr(result, "content_type", "json") == "json" and isinstance(result.parsed, dict):
                return result.parsed
            return intake.parse_json_text(getattr(result, "text", "") or "")
        detail = "the model is busy or rate-limited" if last and any(t.lower() in str(last).lower() for t in _TRANSIENT) \
            else f"{last.__class__.__name__}" if last else "no response"
        raise LlmUnavailable(f"The model call failed ({detail}).")
    return extract


# -- /invoices ----------------------------------------------------------------------------------
_USAGE = ("Usage: /invoices [open|overdue|paid|draft|sync|help]\n"
          "  /invoices          ledger summary from the local cache\n"
          "  /invoices overdue  only overdue invoices\n"
          "  /invoices sync     pull the latest from Stripe, then show the ledger")


def _make_command(ctx: Any) -> Callable[..., str]:
    def handle(raw_args: str = "", **kwargs: Any) -> str:
        arg = (raw_args or "").strip().lower()
        if arg in ("help", "-h", "--help"):
            return _USAGE
        mode = key_mode(runtime.api_key())
        livemode = None if mode not in ("test", "live") else mode == "live"
        status = None
        try:
            if arg == "sync":
                with runtime.make_client(runtime.settings_from(ctx.get_config)) as client:
                    service.sync(client, runtime.store())
            elif arg in ("open", "overdue", "paid", "draft", "void", "outstanding"):
                status = arg
            elif arg:
                return _USAGE
            return service.ledger_text(runtime.store(), livemode=livemode, status=status)
        except StripeError as exc:
            return f"Obol: {exc}"
    return handle


# -- hermes obol --------------------------------------------------------------------------------
def _cli_setup(subparser: Any) -> None:
    subs = subparser.add_subparsers(dest="obol_command")
    subs.add_parser("doctor", help="Check the Stripe key, mode and connectivity")
    subs.add_parser("sync", help="Pull recent invoices from Stripe into the local ledger")
    subs.add_parser("ledger", help="Print the local ledger")


def _make_cli(ctx: Any) -> Callable[[Any], int]:
    def run(args: Any) -> int:
        cmd = getattr(args, "obol_command", None) or "doctor"
        settings = runtime.settings_from(ctx.get_config)
        if cmd == "ledger":
            print(service.ledger_text(runtime.store()))
            return 0
        status = 0
        key = runtime.api_key()
        mode = key_mode(key)
        print(f"Stripe key: {mode}" + ("" if mode in ("test", "live") else f" (set {runtime.KEY_ENV})"))
        print(f"Approval: every Stripe write asks · live mode allowed: {settings.allow_live}")
        for table, label in (("events", "Activity log"), ("security_events", "Security log")):
            chain = runtime.store().verify_chain(table)
            if chain["ok"]:
                print(f"✓ {label}: {chain['entries']} entries, hash chain intact (head {chain['head'][:16]}…)")
            else:
                where = f"at entry #{chain['first_bad_seq']}" if chain["first_bad_seq"] else chain.get("reason", "")
                print(f"✗ {label}: TAMPERED {where}. Someone edited Obol's local log outside Obol.")
                status = 1
        try:
            with runtime.make_client(settings, key) as client:
                out = service.sync(client, runtime.store(), max_pages=1 if cmd == "doctor" else 5)
        except StripeError as exc:
            print(f"✗ {exc}")
            return 1
        print(f"✓ Stripe reachable, {out['synced']} invoice(s) synced")
        if cmd == "sync":
            print(service.ledger_text(runtime.store(), livemode=mode == "live"))
        return status
    return run


# -- register -----------------------------------------------------------------------------------
def register(ctx: Any) -> None:
    handlers = _tool_handlers(ctx)
    for schema in schemas.ALL:
        ctx.register_tool(name=schema["name"], toolset="obol", schema=schema,
                          handler=handlers[schema["name"]], description=schema["description"], emoji="🪙")
    ctx.register_hook("pre_tool_call", _make_gate(ctx))
    after_tool, before_turn = _make_guard_observers(ctx)
    ctx.register_hook("post_tool_call", after_tool)
    ctx.register_hook("pre_llm_call", before_turn)
    ctx.register_command("invoices", _make_command(ctx), description="Obol receivables ledger",
                         args_hint="[open|overdue|paid|draft|sync]")
    ctx.register_cli_command(name="obol", help="Obol invoicing: doctor, sync, ledger",
                             setup_fn=_cli_setup, handler_fn=_make_cli(ctx))
    skill = _PLUGIN_DIR / "skills" / "invoicing" / "SKILL.md"
    if skill.exists():
        ctx.register_skill("invoicing", skill, description="How to invoice, chase and reconcile with Obol")
    _register_blueprint(ctx)


def _register_blueprint(ctx: Any) -> None:
    register_bp = getattr(ctx, "register_automation_blueprint", None)
    if register_bp is None:
        return
    register_bp(
        "overdue-chase",
        title="Chase overdue invoices",
        description="Every Monday, list overdue Stripe invoices and tell you who to chase. Nothing is sent without you.",
        category="work",
        schedule_template="{minute} {hour} * * 1",
        prompt_template=(
            "Use obol_list_invoices with status='overdue'. Reply with a short receivables report: total "
            "outstanding, total overdue, and each invoice more than {grace} days overdue (client, number, "
            "amount, days late), oldest first. Flag anything more than 60 days overdue. Do NOT call "
            "obol_send_reminder or any other Obol write tool: this run is unattended and Obol refuses writes "
            "without a person to approve them. End with one line the user can send back to approve the reminders."
        ),
        slots=[
            {"name": "time", "type": "time", "label": "What time on Mondays?", "default": "09:10"},
            {"name": "grace", "type": "text", "label": "Grace period (days)", "default": "3"},
            {"name": "deliver", "type": "enum", "label": "Where to deliver?", "default": "origin",
             "options": ["origin", "local"], "strict": False},
        ],
        skills=["obol:invoicing"],
        tags=["finance", "weekly"],
    )
