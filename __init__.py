"""Obol: invoices and payment links for Hermes Agent, backed by Stripe.

Surfaces registered here:
* six ``obol_*`` tools (create, send, get, list, remind, void);
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
from .src.obol_lib import money, runtime, service
from .src.obol_lib.service import ValidationError
from .src.obol_lib.stripe_client import StripeError, key_mode

logger = logging.getLogger(__name__)

_PLUGIN_DIR = Path(__file__).resolve().parent
GATED_TOOLS = frozenset({"obol_send_invoice", "obol_send_reminder", "obol_void_invoice"})


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
    except StripeError as exc:
        details = exc.as_dict()
        return _error(details.pop("error"), **details)
    except Exception as exc:  # last line of defence; logged with traceback, short message to the model
        logger.exception("obol: unexpected error")
        return _error(f"Obol hit an unexpected error ({exc.__class__.__name__}). Nothing further was sent.",
                      kind="internal")


# -- approval gate ------------------------------------------------------------------------------
def _approval_message(ctx: Any, tool_name: str, args: dict, mode: str) -> str:
    tag = "LIVE MONEY" if mode == "live" else "test mode"
    if tool_name == "obol_create_invoice":
        cur = str(args.get("currency") or runtime.settings_from(ctx.get_config).default_currency).lower()
        try:
            total = sum(money.to_minor(i.get("amount"), cur) * int(i.get("quantity", 1) or 1)
                        for i in args.get("line_items") or [])
            amount = money.fmt(total, cur)
        except (money.MoneyError, TypeError, ValueError, AttributeError):
            amount = "an invoice"
        return f"Obol will email {args.get('customer_email')} a payment link for {amount} ({tag})."
    verb = {"obol_send_invoice": "send", "obol_send_reminder": "send a reminder for",
            "obol_void_invoice": "VOID (cannot be undone)"}[tool_name]
    inv_id = str(args.get("invoice_id"))
    row = None
    try:
        row = runtime.store().get(inv_id)
    except Exception:
        row = None
    if row:
        who = row.get("customer_name") or row.get("customer_email")
        return (f"Obol will {verb} {row.get('number') or inv_id}: "
                f"{money.fmt(row['amount_due'], row['currency'])} for {who} ({tag}).")
    return f"Obol will {verb} invoice {inv_id} ({tag})."


def _make_gate(ctx: Any) -> Callable[..., Any]:
    def gate(tool_name: str = "", args: dict | None = None, **kwargs: Any):
        args = args if isinstance(args, dict) else {}
        if tool_name not in GATED_TOOLS and not (tool_name == "obol_create_invoice" and args.get("send")):
            return None
        try:
            settings = runtime.settings_from(ctx.get_config)
            mode = key_mode(runtime.api_key())
            if settings.approval == "never" or (settings.approval == "live_only" and mode != "live"):
                return None
            return {"action": "approve", "message": _approval_message(ctx, tool_name, args, mode),
                    "rule_key": f"obol:{tool_name}"}
        except Exception:
            logger.exception("obol: approval gate failed; asking for approval anyway")
            return {"action": "approve", "message": f"Obol wants to run {tool_name}.",
                    "rule_key": f"obol:{tool_name}"}
    return gate


# -- tools --------------------------------------------------------------------------------------
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
        "obol_create_invoice": with_client(lambda c, s, st, a: service.create_invoice(c, s, st, a)),
        "obol_send_invoice": with_client(lambda c, s, st, a: service.send_invoice(c, s, a)),
        "obol_get_invoice": with_client(lambda c, s, st, a: service.get_invoice(c, s, a)),
        "obol_list_invoices": with_client(lambda c, s, st, a: service.list_invoices(c, s, a)),
        "obol_send_reminder": with_client(lambda c, s, st, a: service.send_reminder(c, s, a)),
        "obol_void_invoice": with_client(lambda c, s, st, a: service.void_invoice(c, s, a)),
    }

    def bind(op: Callable[[dict], dict]) -> Callable[..., str]:
        def handler(args: dict, **kwargs: Any) -> str:
            return _run(op, args)
        return handler

    return {name: bind(op) for name, op in ops.items()}


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
        key = runtime.api_key()
        mode = key_mode(key)
        print(f"Stripe key: {mode}" + ("" if mode in ("test", "live") else f" (set {runtime.KEY_ENV})"))
        print(f"Approval: {settings.approval} · live mode allowed: {settings.allow_live}")
        try:
            with runtime.make_client(settings, key) as client:
                out = service.sync(client, runtime.store(), max_pages=1 if cmd == "doctor" else 5)
        except StripeError as exc:
            print(f"✗ {exc}")
            return 1
        print(f"✓ Stripe reachable, {out['synced']} invoice(s) synced")
        if cmd == "sync":
            print(service.ledger_text(runtime.store(), livemode=mode == "live"))
        return 0
    return run


# -- register -----------------------------------------------------------------------------------
def register(ctx: Any) -> None:
    handlers = _tool_handlers(ctx)
    for schema in schemas.ALL:
        ctx.register_tool(name=schema["name"], toolset="obol", schema=schema,
                          handler=handlers[schema["name"]], description=schema["description"], emoji="🪙")
    ctx.register_hook("pre_tool_call", _make_gate(ctx))
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
        description="Every week, find overdue Stripe invoices, remind the ones past a grace period, and report.",
        category="work",
        schedule_template="{minute} {hour} * * 1",
        prompt_template=(
            "Use obol_list_invoices with status='overdue'. For each invoice more than {grace} days overdue, "
            "call obol_send_reminder once. Then reply with a short receivables report: total outstanding, "
            "total overdue, who was reminded, and anything that needs a human (for example invoices more "
            "than 60 days overdue). If a reminder needs approval and nobody can approve it, list it instead."
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
