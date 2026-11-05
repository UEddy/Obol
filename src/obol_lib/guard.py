"""Obol Guard: Obol's money-path protections for OTHER plugins' tools (opt-in).

The user lists tools to guard (``guard_tools``: exact names or ``*`` patterns, e.g.
``agentwalletapi_transfer_send`` or ``laso_*``). Obol's ``pre_tool_call`` hook then, for every call
to a guarded tool:

* asks for approval per call (a fresh rule key each time, so no blanket "always");
* blocks it outright in unattended (cron) runs;
* shows what it can read of the amount and recipient, and flags
  - prompt injection found in the context that led to the call (the user's turn, earlier messages,
    and outputs of other tools in the same session, e.g. a fetched page or an email),
  - an amount far above that tool's history, a first payment to a new recipient, and a recipient
    that imitates a previous one (crypto address poisoning or a lookalike domain);
* records the prompt, the flags and (from ``post_tool_call``) the executed spend in Obol's
  hash-chained logs and Security tab.

Guard sees only what the other plugin passes as tool arguments. It does not know that plugin's
semantics, so amount and recipient are read from common argument names (see AMOUNT_KEYS /
RECIPIENT_KEYS); when it can't find them, the prompt says so.
"""

from __future__ import annotations

import fnmatch
import json
import re
import statistics
import uuid
from typing import Any, Iterable, Optional

from . import security

AMOUNT_KEYS = ("amount", "amountDisplay", "amount_display", "amount_usd", "amountUsd", "value", "total",
               "price", "max_amount", "maxAmount", "spend", "usd", "payment_amount", "budget")
RECIPIENT_KEYS = ("to", "recipient", "address", "destination", "dest", "payee", "receiver", "email",
                  "merchant", "account", "wallet_address", "toAddress", "to_address", "url", "endpoint")
TOKEN_KEYS = ("token", "currency", "asset", "symbol", "coin")
MAX_CONTEXT_CHARS = 20_000
_ADDRESS_RE = re.compile(r"^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$")


def matches(tool_name: str, patterns: Iterable[str]) -> bool:
    if not tool_name or tool_name.startswith("obol_"):
        return False  # Obol's own tools have their own, stricter gate
    return any(fnmatch.fnmatchcase(tool_name, p.strip()) for p in patterns if isinstance(p, str) and p.strip())


def _walk(args: Any, depth: int = 0) -> Iterable[tuple[str, Any]]:
    if depth > 2:
        return
    if isinstance(args, dict):
        for k, v in args.items():
            yield str(k), v
            if isinstance(v, (dict, list)):
                yield from _walk(v, depth + 1)
    elif isinstance(args, list):
        for v in args[:20]:
            yield from _walk(v, depth + 1)


def _number(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.fullmatch(r"\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Za-z]{2,6})?\s*", v)
        if m:
            return float(m.group(1).replace(",", ""))
    return None


def extract(args: dict) -> dict[str, Any]:
    """Best-effort amount / token / recipient from a tool's arguments."""
    amount = recipient = token = None
    lowered = {k.lower(): k for k in AMOUNT_KEYS}
    for k, v in _walk(args):
        kl = k.lower()
        if amount is None and kl in lowered:
            amount = _number(v)
        elif recipient is None and k in RECIPIENT_KEYS and isinstance(v, str) and v.strip():
            recipient = v.strip()
        elif token is None and kl in TOKEN_KEYS and isinstance(v, str) and v.strip():
            token = v.strip().upper()
    return {"amount": amount, "token": token, "recipient": recipient}


def poisoning_reason(new: str, known: str) -> Optional[str]:
    """A crypto address made to look like one you've paid: same start and end, different middle."""
    if new == known or not (_ADDRESS_RE.match(new) and _ADDRESS_RE.match(known)):
        return None
    a, b = new.lower() if new.startswith("0x") else new, known.lower() if known.startswith("0x") else known
    head = 6 if a.startswith("0x") else 4
    if a[:head] == b[:head] and a[-4:] == b[-4:]:
        return "same first and last characters as an address you've paid (address poisoning)"
    return None


def recipient_findings(recipient: Optional[str], history_recipients: list[str]) -> list[dict]:
    if not recipient:
        return []
    known = [r for r in history_recipients if r]
    if recipient in known:
        return []
    for k in sorted(set(known)):
        reason = poisoning_reason(recipient, k)
        if reason:
            return [{"check": "guard_address_poisoning", "severity": "high",
                     "message": f"Recipient {recipient} imitates {k}: {reason}."}]
    if "@" in recipient or "." in recipient:
        host = recipient.rsplit("@", 1)[-1].split("/")[2] if recipient.startswith("http") else recipient.rsplit("@", 1)[-1]
        for k in sorted(set(known)):
            khost = k.rsplit("@", 1)[-1].split("/")[2] if k.startswith("http") else k.rsplit("@", 1)[-1]
            reason = security.lookalike_reason(host, khost)
            if reason:
                return [{"check": "guard_lookalike_recipient", "severity": "high",
                         "message": f"Recipient {recipient} looks like {k} ({reason})."}]
    if known:
        return [{"check": "guard_new_recipient", "severity": "medium",
                 "message": f"First payment through this tool to {recipient}."}]
    return []


def amount_findings(amount: Optional[float], history_amounts: list[float], multiplier: float,
                    min_history: int) -> list[dict]:
    if amount is None or not multiplier:
        return []
    past = [a for a in history_amounts if a and a > 0]
    if len(past) < min_history:
        return []
    typical = statistics.median(past)
    if typical > 0 and amount > multiplier * typical:
        return [{"check": "guard_unusual_amount", "severity": "high",
                 "message": f"{amount:g} is {amount / typical:.1f}x this tool's typical amount ({typical:g} over {len(past)} calls)."}]
    return []


def scan_context(texts: Iterable[tuple[str, str]]) -> list[dict]:
    """Injection findings in the context around a call, as (source, text) pairs."""
    findings = []
    for source, text in texts:
        if not isinstance(text, str) or not text:
            continue
        for f in security.detect_injection(text[-MAX_CONTEXT_CHARS:]):
            if f["severity"] == "high":
                findings.append({"check": "guard_injection", "severity": "high",
                                 "message": f"Context before this call ({source}): {f['message']}"})
                break
    return findings


def describe(tool_name: str, info: dict) -> str:
    what = f"{info['amount']:g} {info['token'] or ''}".strip() if info["amount"] is not None else "an amount Obol could not read"
    to = info["recipient"] or "a recipient Obol could not read"
    return f"Obol Guard: {tool_name} wants to send {what} to {to}"


def history_text(value: Any) -> str:
    try:
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(value)


def new_ref(tool_name: str) -> str:
    return f"guard:{tool_name}:{uuid.uuid4().hex[:12]}"
