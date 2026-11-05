"""The approval policy behind Obol's ``pre_tool_call`` hook, as a pure function.

Rules (every one of them fails closed):
* Every tool that writes to Stripe (create, send, remind, void) is escalated to Hermes's
  human-approval prompt. There is no setting that turns this off.
* A live key is refused outright unless ``allow_live`` is true.
* In an unattended run (cron) nobody can approve, so the call is blocked with a clear
  message instead of being left to an approval mode that might auto-approve.
* Each approval gets its own ``rule_key``, so answering "always" once can never pre-approve
  a later invoice.
"""

from __future__ import annotations

import uuid
from typing import Any, Callable, Optional

from . import money

WRITE_TOOLS = frozenset({"obol_create_invoice", "obol_send_invoice", "obol_send_reminder", "obol_void_invoice"})
_VERBS = {"obol_send_invoice": "finalize and email", "obol_send_reminder": "re-send the payment email for",
          "obol_void_invoice": "VOID (cannot be undone)"}


def describe_create(args: dict, default_currency: str) -> str:
    cur = str(args.get("currency") or default_currency).lower()
    try:
        total = sum(money.to_minor(i.get("amount"), cur) * int(i.get("quantity", 1) or 1)
                    for i in args.get("line_items") or [])
        amount = money.fmt(total, cur)
    except (money.MoneyError, TypeError, ValueError, AttributeError):
        amount = "an invoice (amount could not be read)"
    who = args.get("customer_name") or args.get("customer_email")
    if args.get("send"):
        return f"Create and EMAIL {args.get('customer_email')} ({who}) a payment link for {amount}"
    return f"Create a draft invoice for {who} <{args.get('customer_email')}>: {amount} (not sent yet)"


def describe_existing(tool_name: str, invoice_id: str, row: Optional[dict]) -> str:
    verb = _VERBS[tool_name]
    if row:
        who = row.get("customer_name") or row.get("customer_email")
        return (f"{verb[0].upper()}{verb[1:]} {row.get('number') or invoice_id}: "
                f"{money.fmt(row['amount_due'], row['currency'])} for {who} <{row.get('customer_email')}>")
    return f"{verb[0].upper()}{verb[1:]} invoice {invoice_id}"


def format_flags(flags: list[dict]) -> str:
    """Flags for an approval prompt: one headline each, so they fit Hermes's prompt box. The full detail of
    every flag is in the Security tab and ``hermes obol ledger``."""
    if not flags:
        return "Risk checks: none raised."
    lines = ["RISK CHECKS (details in the Security tab):"]
    for f in flags:
        text = f.get("short") or str(f.get("message"))
        if len(text) > 110:
            text = text[:109] + "…"
        lines.append(f"[{str(f.get('severity', 'info')).upper()}] {text}")
    return "\n".join(lines)


def decide(tool_name: str, args: dict, *, mode: str, allow_live: bool, unattended: bool,
           summary: Callable[[], str], assess: Callable[[], list[dict]]) -> Optional[dict[str, Any]]:
    """Return a pre_tool_call directive, or None to let a read-only call through."""
    if tool_name not in WRITE_TOOLS:
        return None
    if mode == "live" and not allow_live:
        return {"action": "block", "message": (
            "Obol refused: STRIPE_API_KEY is a LIVE key and live mode is off "
            "(plugins.entries.obol.settings.allow_live). Nothing was sent to Stripe.")}
    if unattended:
        return {"action": "block", "message": (
            f"Obol refused {tool_name}: this is an unattended run (cron) and every Stripe write needs a "
            "person to approve it. Nothing was sent. Report what needs doing so the user can approve it in chat.")}
    if mode not in ("test", "live"):
        return None  # the tool itself answers with a clear not_configured error and writes nothing
    try:
        flags = assess()
    except Exception as exc:  # a broken check must not hide the prompt
        flags = [{"check": "unavailable", "severity": "info",
                  "message": f"Risk checks could not run ({exc.__class__.__name__}); review carefully."}]
    tag = "LIVE MONEY" if mode == "live" else "Stripe TEST mode"
    message = f"Obol ({tag}): {summary()}.\n{format_flags(flags)}"
    return {"action": "approve", "message": message, "rule_key": f"obol:{tool_name}:{uuid.uuid4().hex}"}
