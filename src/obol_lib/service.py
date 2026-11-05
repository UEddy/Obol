"""Invoice operations. Each takes a ``StripeClient`` and a ``Store`` and returns plain dicts.

Validation happens here before any network call, so a bad request never half-creates an invoice.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

from . import money
from .store import Store, display_status, is_overdue
from .stripe_client import StripeClient, StripeError

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_INVOICE_ID_RE = re.compile(r"^in_[A-Za-z0-9]{6,}$")
MAX_LINE_ITEMS = 25
LIST_STATUSES = ("draft", "open", "paid", "void", "uncollectible", "overdue", "outstanding")


@dataclass(frozen=True)
class Settings:
    default_currency: str = "usd"
    default_days_until_due: int = 14
    allow_live: bool = False
    # Risk checks (0 turns a check off).
    risk_duplicate_window_days: int = 30
    risk_amount_multiplier: float = 3.0
    risk_amount_min_history: int = 3
    risk_contact_change_days: int = 14


class ValidationError(ValueError):
    pass


# -- helpers ------------------------------------------------------------------------------------
def _email(value: object) -> str:
    if not isinstance(value, str) or not _EMAIL_RE.match(value.strip()):
        raise ValidationError(f"customer_email must be a valid email address, got {value!r}")
    return value.strip().lower()


def invoice_id(value: object) -> str:
    if not isinstance(value, str) or not _INVOICE_ID_RE.match(value.strip()):
        raise ValidationError(f"invoice_id must be a Stripe invoice id like 'in_1Abc...', got {value!r}")
    return value.strip()


def _days(value: object, default: int) -> int:
    if value is None:
        return default
    try:
        days = int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"days_until_due must be a whole number, got {value!r}") from None
    if not 0 <= days <= 365:
        raise ValidationError("days_until_due must be between 0 and 365")
    return days


def _line_items(items: object, currency: str) -> list[dict[str, Any]]:
    if not isinstance(items, list) or not items:
        raise ValidationError("line_items must be a non-empty list of {description, amount, quantity}")
    if len(items) > MAX_LINE_ITEMS:
        raise ValidationError(f"at most {MAX_LINE_ITEMS} line items per invoice")
    out = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValidationError(f"line_items[{i}] must be an object")
        desc = item.get("description")
        if not isinstance(desc, str) or not desc.strip():
            raise ValidationError(f"line_items[{i}].description is required")
        qty = item.get("quantity", 1)
        if isinstance(qty, bool) or not isinstance(qty, (int, float)) or int(qty) != qty or not 1 <= qty <= 10_000:
            raise ValidationError(f"line_items[{i}].quantity must be a whole number from 1 to 10000")
        try:
            unit = money.to_minor(item.get("amount"), currency)
        except money.MoneyError as exc:
            raise ValidationError(f"line_items[{i}]: {exc}") from None
        out.append({"description": desc.strip()[:500], "unit_amount": unit, "quantity": int(qty)})
    return out


def view(row: dict, now: Optional[float] = None) -> dict[str, Any]:
    """The compact, model-friendly shape of a cached invoice row."""
    cur = row["currency"]
    out = {
        "invoice_id": row["id"],
        "number": row.get("number"),
        "status": display_status(row, now),
        "customer": row.get("customer_name") or row.get("customer_email"),
        "customer_email": row.get("customer_email"),
        "currency": cur,
        "amount_due": money.fmt(row["amount_due"], cur),
        "amount_paid": money.fmt(row["amount_paid"], cur),
        "amount_remaining": money.fmt(row["amount_remaining"], cur),
        "due_date": time.strftime("%Y-%m-%d", time.gmtime(row["due_date"])) if row.get("due_date") else None,
        "payment_link": row.get("hosted_url"),
        "mode": "live" if row.get("livemode") else "test",
    }
    if row.get("paid_at"):
        out["paid_at"] = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(row["paid_at"]))
    if is_overdue(row, now):
        out["days_overdue"] = int(((now or time.time()) - row["due_date"]) // 86400)
    return out


def _sync_one(client: StripeClient, store: Store, inv_id: str) -> dict:
    inv = client.get_invoice(inv_id)
    store.upsert([inv])
    return store.get(inv_id) or {}


# -- operations ---------------------------------------------------------------------------------
def create_invoice(client: StripeClient, store: Store, settings: Settings, args: dict) -> dict:
    currency = money.normalize_currency(args.get("currency") or settings.default_currency)
    email = _email(args.get("customer_email"))
    name = args.get("customer_name")
    name = name.strip()[:200] if isinstance(name, str) and name.strip() else None
    items = _line_items(args.get("line_items"), currency)
    days = _days(args.get("days_until_due"), settings.default_days_until_due)
    memo = args.get("memo")
    memo = memo.strip()[:500] if isinstance(memo, str) and memo.strip() else None
    total = sum(i["unit_amount"] * i["quantity"] for i in items)
    if total > money.MAX_MINOR:
        raise ValidationError("invoice total exceeds Stripe's maximum amount")

    op = uuid.uuid4().hex  # one id per tool call: every Stripe POST below is idempotent under it
    customer = client.find_customer_by_email(email)
    if customer is None:
        customer = client.create_customer(email=email, name=name, idempotency_key=f"obol-{op}-cus")
    invoice = client.create_invoice(customer=customer["id"], currency=currency, days_until_due=days,
                                    description=memo, metadata={"created_by": "obol"},
                                    idempotency_key=f"obol-{op}-inv")
    try:
        for n, item in enumerate(items):
            client.add_invoice_item(customer=customer["id"], invoice=invoice["id"], currency=currency,
                                    idempotency_key=f"obol-{op}-item{n}", **item)
    except StripeError:
        # Don't leave a half-built draft behind; best effort, the original error is what matters.
        try:
            client.delete_draft(invoice["id"])
        except StripeError:
            pass
        raise
    row = _sync_one(client, store, invoice["id"])
    store.log("created", invoice["id"], f"{money.fmt(total, currency)} for {name or email}")
    result = {"created": True, "invoice": view(row)}
    if args.get("send"):
        result.update(send_invoice(client, store, {"invoice_id": invoice["id"]}))
    else:
        result["next_step"] = "Draft created. Call obol_send_invoice to finalize it and email the payment link."
    return result


def send_invoice(client: StripeClient, store: Store, args: dict) -> dict:
    inv_id = invoice_id(args.get("invoice_id"))
    op = uuid.uuid4().hex
    inv = client.get_invoice(inv_id)
    if inv.get("status") == "draft":
        inv = client.finalize_invoice(inv_id, idempotency_key=f"obol-{op}-fin")
    if inv.get("status") != "open":
        raise ValidationError(f"invoice {inv_id} is {inv.get('status')}; only draft or open invoices can be sent")
    inv = client.send_invoice(inv_id, idempotency_key=f"obol-{op}-send")
    store.upsert([inv])
    row = store.get(inv_id) or {}
    store.log("sent", inv_id, f"to {row.get('customer_email')}")
    return {"sent": True, "invoice": view(row), "payment_link": row.get("hosted_url")}


def send_reminder(client: StripeClient, store: Store, args: dict) -> dict:
    inv_id = invoice_id(args.get("invoice_id"))
    inv = client.get_invoice(inv_id)
    if inv.get("status") != "open":
        raise ValidationError(f"invoice {inv_id} is {inv.get('status')}; reminders only go out for open invoices")
    inv = client.send_invoice(inv_id, idempotency_key=f"obol-{uuid.uuid4().hex}-remind")
    store.upsert([inv])
    row = store.get(inv_id) or {}
    store.log("reminded", inv_id, f"to {row.get('customer_email')}")
    return {"reminded": True, "invoice": view(row)}


def void_invoice(client: StripeClient, store: Store, args: dict) -> dict:
    inv_id = invoice_id(args.get("invoice_id"))
    inv = client.get_invoice(inv_id)
    status = inv.get("status")
    if status == "draft":
        client.delete_draft(inv_id)
        store.remove(inv_id)
        store.log("deleted", inv_id, "draft deleted")
        return {"deleted": True, "invoice_id": inv_id, "note": "Draft deleted (drafts are never sent)."}
    if status != "open":
        raise ValidationError(f"invoice {inv_id} is {status}; only open invoices can be voided")
    inv = client.void_invoice(inv_id, idempotency_key=f"obol-{uuid.uuid4().hex}-void")
    store.upsert([inv])
    store.log("voided", inv_id, args.get("reason") or "")
    return {"voided": True, "invoice": view(store.get(inv_id) or {})}


def get_invoice(client: StripeClient, store: Store, args: dict) -> dict:
    if args.get("invoice_id"):
        inv_id = invoice_id(args["invoice_id"])
        _upsert_with_paid_log(store, [client.get_invoice(inv_id)])
        return {"invoice": view(store.get(inv_id) or {})}
    if args.get("customer_email"):
        email = _email(args["customer_email"])
        customer = client.find_customer_by_email(email)
        if customer is None:
            return {"invoice": None, "note": f"No Stripe customer with email {email}."}
        found = client.list_invoices(customer=customer["id"], limit=5).get("data") or []
        _upsert_with_paid_log(store, found)
        rows = [view(store.get(i["id"]) or {}) for i in found]
        return {"invoice": rows[0] if rows else None, "recent": rows[1:]}
    raise ValidationError("pass invoice_id or customer_email")


def _upsert_with_paid_log(store: Store, invoices: list[dict]) -> None:
    before = {i["id"]: (store.get(i["id"]) or {}).get("status") for i in invoices if i.get("id")}
    store.upsert(invoices)
    for inv_id, prev in before.items():
        row = store.get(inv_id)
        if row and row["status"] == "paid" and prev and prev != "paid":
            store.log("paid", inv_id, money.fmt(row["amount_paid"], row["currency"]))


def sync(client: StripeClient, store: Store, *, max_pages: int = 5) -> dict:
    """Pull the most recent invoices (up to ``max_pages`` x 100) from Stripe into the cache."""
    fetched, after = [], None
    for _ in range(max(1, max_pages)):
        page = client.list_invoices(limit=100, starting_after=after)
        data = page.get("data") or []
        fetched.extend(data)
        if not page.get("has_more") or not data:
            break
        after = data[-1]["id"]
    _upsert_with_paid_log(store, fetched)
    store.set_meta("last_sync", str(int(time.time())))
    return {"synced": len(fetched)}


def list_invoices(client: Optional[StripeClient], store: Store, args: dict) -> dict:
    status = args.get("status")
    if status is not None and status not in LIST_STATUSES:
        raise ValidationError(f"status must be one of {', '.join(LIST_STATUSES)}")
    email = _email(args["customer_email"]) if args.get("customer_email") else None
    limit = args.get("limit", 20)
    limit = max(1, min(int(limit), 100)) if isinstance(limit, int) and not isinstance(limit, bool) else 20
    synced = None
    if client is not None and args.get("refresh", True):
        synced = sync(client, store)["synced"]
    livemode = None if client is None else client.mode == "live"
    rows = store.invoices(status=status, customer_email=email, livemode=livemode, limit=limit)
    return {"invoices": [view(r) for r in rows], "count": len(rows), "synced_from_stripe": synced,
            "totals": summary_text(store, livemode=livemode)}


def summary_text(store: Store, *, livemode: Optional[bool] = None) -> dict[str, dict[str, str]]:
    return {cur: {k: (money.fmt(v, cur) if not k.startswith("count_") else v) for k, v in t.items()}
            for cur, t in store.summary(livemode=livemode).items()}


def ledger_text(store: Store, *, livemode: Optional[bool] = None, status: Optional[str] = None,
                limit: int = 10) -> str:
    """Plain-text ledger for slash commands and messaging surfaces."""
    totals = store.summary(livemode=livemode)
    lines = ["OBOL LEDGER" + (" (TEST MODE)" if livemode is False else "")]
    if not totals:
        lines.append("No invoices yet. Ask Hermes to invoice someone, or run /invoices sync.")
        return "\n".join(lines)
    for cur, t in sorted(totals.items()):
        lines.append(f"{cur.upper()}  outstanding {money.fmt(t['outstanding'], cur)} ({t['count_outstanding']})"
                     f" · overdue {money.fmt(t['overdue'], cur)} ({t['count_overdue']})"
                     f" · paid {money.fmt(t['paid'], cur)} ({t['count_paid']})")
    rows = [r for r in store.invoices(status=status, livemode=livemode, limit=limit + 50)
            if status or r["status"] != "void"][:limit]
    if rows:
        lines.append("")
    for r in rows:
        v = view(r)
        due = f" due {v['due_date']}" if v["due_date"] and v["status"] in ("open", "overdue") else ""
        lines.append(f"[{v['status'].upper():>8}] {v['number'] or r['id']}  {v['customer'] or '-'}  "
                     f"{v['amount_due']}{due}")
    last = store.get_meta("last_sync")
    if last:
        lines.append(f"\nlast synced {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime(int(last)))}")
    return "\n".join(lines)
