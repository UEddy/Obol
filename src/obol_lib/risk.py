"""Risk checks that run inside the approval hook, before a person approves a Stripe write.

These are warnings for the human approving the call. They are NOT complete fraud
prevention: they only see Obol's local cache, the customer's invoices on Stripe, and the
last 30 days of Stripe events.

Checks (each one turned off by setting its config value to 0):
* duplicate        same customer, same amount and currency, created within N days
* unusual_amount   amount above N x the customer's average invoice (needs enough history)
* contact_change   the customer's email or payment details changed in Stripe within N days
* impersonation    a client name you've billed before, now at a domain you've never used for them
* lookalike_domain the email's domain imitates one you've billed (pinernoor.example vs pinemoor.example)
* prompt_injection the invoice was drafted from a forwarded message that tried to inject instructions
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Optional

from . import money, security
from .service import Settings
from .store import Store
from .stripe_client import StripeClient, StripeError

CONTACT_FIELDS = ("email", "invoice_settings", "default_source", "sources", "address")
_LIVE_STATUSES = ("draft", "open", "paid", "uncollectible")


def flag(check: str, severity: str, message: str) -> dict[str, str]:
    return {"check": check, "severity": severity, "message": message}


def create_fingerprint(args: dict, default_currency: str) -> Optional[str]:
    """Stable id for a create call, so the hook's findings can be attached to the invoice it creates."""
    try:
        cur = money.normalize_currency(args.get("currency") or default_currency)
        items = sorted((str(i.get("description", "")).strip(), money.to_minor(i.get("amount"), cur),
                        int(i.get("quantity", 1) or 1)) for i in args.get("line_items") or [])
        key = [str(args.get("customer_email", "")).strip().lower(), cur, items, bool(args.get("send"))]
    except (money.MoneyError, TypeError, ValueError, AttributeError):
        return None
    return hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()


def _ago(seconds: float) -> str:
    days = int(seconds // 86400)
    if days >= 1:
        return f"{days} day{'s' if days != 1 else ''} ago"
    hours = int(seconds // 3600)
    return f"{hours} hour{'s' if hours != 1 else ''} ago" if hours else "just now"


def _refresh_customer(client: Optional[StripeClient], store: Store, email: str) -> Optional[dict]:
    """Pull this customer's invoices from Stripe so the checks also see invoices made outside Obol."""
    if client is None:
        return None
    customer = client.find_customer_by_email(email)
    if customer:
        store.upsert(client.list_invoices(customer=customer["id"], limit=100).get("data") or [])
    return customer


def assess(store: Store, settings: Settings, *, customer_email: Optional[str], customer_name: Optional[str],
           amount_minor: Optional[int], currency: str, client: Optional[StripeClient] = None,
           exclude_invoice_id: Optional[str] = None, now: Optional[float] = None) -> list[dict]:
    now = now or time.time()
    flags: list[dict] = []
    email = (customer_email or "").strip().lower()
    if not email:
        return flags

    customer = None
    try:
        customer = _refresh_customer(client, store, email)
    except StripeError as exc:
        flags.append(flag("unavailable", "info", f"Could not refresh this customer's invoices from Stripe ({exc.kind}); "
                                                 "checks below use Obol's local cache only."))

    history = [r for r in store.invoices(customer_email=email, limit=1000, now=now)
               if r["id"] != exclude_invoice_id and r["status"] in _LIVE_STATUSES]

    # duplicate ---------------------------------------------------------------------------------
    window = settings.risk_duplicate_window_days
    if window and amount_minor:
        since = now - window * 86400
        for r in history:
            if r["currency"] == currency and r["amount_due"] == amount_minor and (r.get("created") or 0) >= since:
                flags.append(flag("duplicate", "high",
                                  f"Possible duplicate: {r.get('number') or 'a draft'} to {email} for "
                                  f"{money.fmt(amount_minor, currency)} was created {_ago(now - (r.get('created') or now))} "
                                  f"({r['status']})."))
                break

    # unusual amount ----------------------------------------------------------------------------
    mult = settings.risk_amount_multiplier
    if mult and amount_minor:
        past = [r["amount_due"] for r in history if r["currency"] == currency and r["status"] != "draft"]
        if len(past) >= settings.risk_amount_min_history:
            avg = sum(past) / len(past)
            if avg > 0 and amount_minor > mult * avg:
                who = customer_name or email
                flags.append(flag("unusual_amount", "medium",
                                  f"{money.fmt(amount_minor, currency)} is {amount_minor / avg:.1f}x {who}'s average "
                                  f"invoice ({money.fmt(int(avg), currency)} over {len(past)} invoices)."))

    # contact / payment details change ----------------------------------------------------------
    days = settings.risk_contact_change_days
    if days:
        if client is not None and customer:
            try:
                events = client.list_events(types=["customer.updated"], created_gte=int(now - days * 86400)).get("data") or []
            except StripeError as exc:
                events = []
                flags.append(flag("unavailable", "info",
                                  f"Could not read recent Stripe events ({exc.kind}); contact-change check incomplete."))
            for ev in events:
                obj = (ev.get("data") or {}).get("object") or {}
                prev = (ev.get("data") or {}).get("previous_attributes") or {}
                changed = [k for k in CONTACT_FIELDS if k in prev]
                if obj.get("id") != customer["id"] or not changed:
                    continue
                detail = ""
                if "email" in prev:
                    detail = f" (email was {prev.get('email') or 'empty'}, now {obj.get('email')})"
                flags.append(flag("contact_change", "high",
                                  f"This customer's {', '.join(c.replace('_', ' ') for c in changed)} changed in Stripe "
                                  f"{_ago(now - (ev.get('created') or now))}{detail}. Verify before sending."))
                break
    # impersonation: a client you know, writing from a domain you've never billed for them ---------
    if settings.risk_impersonation and customer_name:
        known = store.emails_for_name(customer_name) - {email}
        known_domains = {e.rsplit("@", 1)[1] for e in known if "@" in e}
        if known and email.rsplit("@", 1)[-1] not in known_domains:
            flags.append(flag("impersonation", "high",
                              f"{customer_name} was billed before at {', '.join(sorted(known))}, not {email}. "
                              "Confirm the new address with the client through a channel you already trust."))

    # lookalike domains ---------------------------------------------------------------------------
    if settings.risk_lookalike_domains:
        flags.extend(security.lookalike_findings(email, store.all_emails() - {email}))

    # carried over from message intake (a prompt-injection attempt in the forwarded message) -------
    carried = store.recent_intake_flags([email, customer_name or ""])
    if any(f.get("check") == "prompt_injection" for f in carried):
        worst = next(f for f in carried if f.get("check") == "prompt_injection")
        flags.append(flag("prompt_injection", "high",
                          "This invoice was drafted from a forwarded message that tried to inject instructions: "
                          + worst["message"]))
    return flags
