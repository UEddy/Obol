"""Bank-transfer mode: a local payment provider with no network at all.

Implements the part of ``StripeClient``'s interface that Obol's service layer uses, keeping invoices in Obol's own
SQLite store, so every approval, risk check, log, ``/invoices`` and the dashboard work the same as with Stripe.
"Sending" an invoice issues it: it gets a number and a due date, and a PDF is written with your bank details and the
invoice number as the payment reference. Obol emails nobody in this mode; you send the PDF yourself. Payments are
recorded with ``obol_mark_paid`` (which asks for approval like every other write).
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any, Optional

from . import money
from .stripe_client import StripeError

PAYOUT_FIELDS = ("bank_account_name", "bank_name", "bank_account_number", "bank_routing")


class BankClient:
    mode = "bank"

    def __init__(self, store: Any, settings: Any, pdf_dir: Path):
        self.store, self.settings, self.pdf_dir = store, settings, Path(pdf_dir)

    # context manager, like StripeClient
    def __enter__(self) -> "BankClient":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def close(self) -> None:
        return None

    # -- storage -------------------------------------------------------------------------------
    def _put(self, kind: str, obj: dict) -> dict:
        self.store.local_put(kind, obj["id"], obj)
        return obj

    def _get(self, kind: str, obj_id: str) -> dict:
        obj = self.store.local_get(kind, obj_id)
        if obj is None:
            raise StripeError(f"No such {kind}: {obj_id}", kind="not_found", status=404)
        return obj

    # -- customers -----------------------------------------------------------------------------
    def find_customer_by_email(self, email: str) -> Optional[dict]:
        found = [c for c in self.store.local_list("customer") if (c.get("email") or "").lower() == email.lower()]
        return found[0] if found else None

    def create_customer(self, *, email: str, name: Optional[str], idempotency_key: str) -> dict:
        return self._put("customer", {"id": "cus_bank" + uuid.uuid4().hex[:14], "email": email, "name": name,
                                      "created": int(time.time())})

    # -- invoices ------------------------------------------------------------------------------
    def create_invoice(self, *, customer: str, currency: str, days_until_due: int, description: Optional[str],
                       metadata: dict, idempotency_key: str) -> dict:
        cus = self._get("customer", customer)
        return self._put("invoice", {
            "id": "in_bank" + uuid.uuid4().hex[:14], "object": "invoice", "number": None, "customer": customer,
            "customer_name": cus.get("name"), "customer_email": cus.get("email"), "currency": currency,
            "description": description, "status": "draft", "amount_due": 0, "amount_paid": 0, "amount_remaining": 0,
            "created": int(time.time()), "due_date": None, "days_until_due": days_until_due, "livemode": True,
            "lines": {"data": []}, "status_transitions": {}, "hosted_invoice_url": None, "invoice_pdf": None,
            "metadata": dict(metadata), "payment_method": "bank_transfer"})

    def add_invoice_item(self, *, customer: str, invoice: str, currency: str, description: str, unit_amount: int,
                         quantity: int, idempotency_key: str) -> dict:
        inv = self._get("invoice", invoice)
        if inv["status"] != "draft":
            raise StripeError("Only draft invoices can be changed.", kind="invalid_request")
        amount = unit_amount * quantity
        inv["lines"]["data"].append({"description": description, "unit_amount": unit_amount, "quantity": quantity,
                                     "amount": amount})
        inv["amount_due"] = inv["amount_remaining"] = sum(l["amount"] for l in inv["lines"]["data"])
        return self._put("invoice", inv)

    def finalize_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict:
        inv = self._get("invoice", invoice_id)
        if inv["status"] != "draft":
            return inv
        missing = [f for f in ("bank_account_name", "bank_account_number") if not getattr(self.settings, f, "")]
        if missing:
            raise StripeError("Set your bank details first (" + ", ".join(missing) + " in Obol's settings): the PDF "
                              "invoice tells your client where to pay.", kind="not_configured")
        now = int(time.time())
        inv["number"] = f"INV-{self.store.next_counter('bank_invoice_number'):04d}"
        inv["status"] = "open"
        inv["status_transitions"]["finalized_at"] = now
        inv["due_date"] = now + int(inv.get("days_until_due") or 0) * 86400
        inv["invoice_pdf"] = str(self._write_pdf(inv))
        return self._put("invoice", inv)

    def send_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict:
        inv = self._get("invoice", invoice_id)
        if inv["status"] != "open":
            raise StripeError(f"Invoice {invoice_id} is {inv['status']}.", kind="invalid_request")
        inv.setdefault("sent_at", []).append(int(time.time()))   # issued; you send the PDF yourself
        return self._put("invoice", inv)

    def mark_paid(self, invoice_id: str, *, idempotency_key: str) -> dict:
        inv = self._get("invoice", invoice_id)
        if inv["status"] != "open":
            raise StripeError(f"Invoice {invoice_id} is {inv['status']}; only open invoices can be marked paid.",
                              kind="invalid_request")
        inv.update(status="paid", amount_paid=inv["amount_due"], amount_remaining=0)
        inv["status_transitions"]["paid_at"] = int(time.time())
        return self._put("invoice", inv)

    def void_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict:
        inv = self._get("invoice", invoice_id)
        inv["status"] = "void"
        return self._put("invoice", inv)

    def delete_draft(self, invoice_id: str) -> dict:
        self.store.local_delete("invoice", invoice_id)
        return {"id": invoice_id, "deleted": True}

    def get_invoice(self, invoice_id: str) -> dict:
        return self._get("invoice", invoice_id)

    def list_invoices(self, *, limit: int = 100, status: Optional[str] = None, customer: Optional[str] = None,
                      starting_after: Optional[str] = None, **_: Any) -> dict:
        rows = [i for i in self.store.local_list("invoice")
                if (status is None or i["status"] == status) and (customer is None or i["customer"] == customer)]
        rows.sort(key=lambda i: i["created"], reverse=True)
        return {"data": rows[:limit], "has_more": False}

    # Stripe-only reads: nothing to report in bank-transfer mode.
    def list_events(self, **_: Any) -> dict:
        return {"data": []}

    def get_charge(self, charge_id: str) -> dict:
        return {}

    def list_disputes(self, charge_id: str) -> list:
        return []

    # -- the PDF -------------------------------------------------------------------------------
    def _write_pdf(self, inv: dict) -> Path:
        s, cur = self.settings, inv["currency"]
        due = time.strftime("%d %b %Y", time.gmtime(inv["due_date"]))
        issued = time.strftime("%d %b %Y", time.gmtime(inv["status_transitions"]["finalized_at"]))
        lines: list[tuple] = [
            ("F2", 22, getattr(s, "business_name", "") or s.bank_account_name),
            ("F1", 11, ""),
            ("F2", 18, f"INVOICE {inv['number']}"),
            ("F1", 11, f"Issued {issued}    Due {due}"),
            ("F1", 11, ""),
            ("F2", 11, "Bill to"),
            ("F1", 11, inv.get("customer_name") or ""),
            ("F1", 11, inv.get("customer_email") or ""),
            ("F1", 11, ""),
        ]
        for l in inv["lines"]["data"]:
            qty = f"{l['quantity']} x " if l["quantity"] != 1 else ""
            lines.append(("F1", 11, f"{qty}{l['description'][:70]}", money.fmt(l["amount"], cur)))
        lines += [
            ("F1", 11, ""),
            ("F2", 14, "Total due", money.fmt(inv["amount_due"], cur)),
            ("F1", 11, ""),
            ("F2", 11, "Pay by bank transfer to"),
            ("F1", 11, f"Account name: {s.bank_account_name}"),
        ]
        if getattr(s, "bank_name", ""):
            lines.append(("F1", 11, f"Bank: {s.bank_name}"))
        lines.append(("F1", 11, f"Account number: {s.bank_account_number}"))
        if getattr(s, "bank_routing", ""):
            lines.append(("F1", 11, f"Routing / sort code / IBAN / SWIFT: {s.bank_routing}"))
        lines += [("F1", 11, f"Payment reference: {inv['number']}"), ("F1", 11, ""),
                  ("F1", 9, "Before paying, confirm these details with us by phone if they differ from previous invoices.")]
        self.pdf_dir.mkdir(parents=True, exist_ok=True)
        path = self.pdf_dir / f"{inv['number']}.pdf"
        path.write_bytes(simple_pdf(lines))
        return path


def _pdf_text(text: str) -> str:
    text = text.encode("latin-1", "replace").decode("latin-1")
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def simple_pdf(lines: list[tuple]) -> bytes:
    """A one-page A4 PDF of text lines (font F1 = Helvetica, F2 = Helvetica-Bold). No dependencies.

    Each line is (font, size, text) or (font, size, text, right_text); right_text is right-aligned at the margin."""
    y, ops = 790, ["BT"]
    for font, size, text, *right in lines:
        if text:
            ops.append(f"/{font} {size} Tf 1 0 0 1 56 {y} Tm ({_pdf_text(text)}) Tj")
        if right:
            x = 539 - len(right[0]) * size * 0.556          # Helvetica digits are 0.556 em wide
            ops.append(f"/{font} {size} Tf 1 0 0 1 {x:.1f} {y} Tm ({_pdf_text(right[0])}) Tj")
        y -= int(size * 1.6)
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def payout_fingerprint(settings: Any) -> str:
    """Short, non-reversible id of the payout details, so a change can be spotted without storing them in the log."""
    import hashlib
    raw = "|".join(str(getattr(settings, f, "") or "").strip().lower() for f in PAYOUT_FIELDS)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def account_tail(settings: Any) -> str:
    num = str(getattr(settings, "bank_account_number", "") or "").replace(" ", "")
    return num[-4:] if num else "none"
