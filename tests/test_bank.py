"""Bank-transfer mode: Obol keeps the invoices itself and issues PDF invoices with your bank details.

No network at all, and every approval, risk check and log works as with Stripe."""

from __future__ import annotations

import dataclasses

import pytest

from obol_lib import gate, risk, service
from obol_lib.bank_client import BankClient, payout_fingerprint, simple_pdf
from obol_lib.service import Settings, ValidationError
from obol_lib.store import Store
from obol_lib.stripe_client import StripeError

BANK = Settings(provider="bank_transfer", business_name="Dana Okafor Studio", bank_account_name="Dana Okafor",
                bank_name="Example Bank", bank_account_number="0123456789", bank_routing="GB33 EXMP 1234 5678")
ARGS = {"customer_email": "billing@acmestudio.example.com", "customer_name": "Acme Studio", "send": True,
        "line_items": [{"description": "Website build", "amount": 2000}, {"description": "Revisions", "amount": 400}]}


@pytest.fixture
def bank(tmp_path):
    store = Store.memory()
    return BankClient(store, BANK, tmp_path / "invoices"), store, tmp_path


def test_issue_writes_a_pdf_with_bank_details_and_reference(bank):
    client, store, tmp = bank
    out = service.create_invoice(client, store, BANK, dict(ARGS))
    inv = out["invoice"]
    assert out["issued"] is True and inv["status"] == "open" and inv["amount_due"] == "$2,400.00"
    assert inv["mode"] == "bank transfer" and inv["number"] == "INV-0001"
    pdf = (tmp / "invoices" / "INV-0001.pdf").read_bytes()
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    for text in (b"INVOICE INV-0001", b"Acme Studio", b"Total due", b"($2,400.00)", b"Account number: 0123456789",
                 b"Payment reference: INV-0001", b"GB33 EXMP 1234 5678"):
        assert text in pdf, text
    assert "send this PDF" in out["next_step"]


def test_bank_and_stripe_invoices_never_mix(bank):
    """Switching provider keeps each mode's list, totals and ledger to its own invoices."""
    client, store, _ = bank
    service.create_invoice(client, store, BANK, dict(ARGS))
    store.upsert([{"id": "in_1StripeTest", "number": "OBOL-0001", "customer": "cus_1", "customer_email": "a@b.example",
                          "customer_name": "Stripe Client", "currency": "usd", "status": "open", "amount_due": 90000,
                          "amount_paid": 0, "amount_remaining": 90000, "created": 1, "livemode": False}])
    listed = service.list_invoices(client, store, {})
    assert [i["invoice_id"][:7] for i in listed["invoices"]] == ["in_bank"]
    assert listed["totals"]["usd"]["outstanding"] == "$2,400.00"
    assert "(BANK TRANSFER)" in service.ledger_text(store, **service.scope("bank"))
    stripe_view = service.ledger_text(store, **service.scope("test"))
    assert "$900.00" in stripe_view and "$2,400.00" not in stripe_view
    assert "$2,400.00" not in service.ledger_text(store, **service.scope("missing"))


def test_no_network_and_nobody_emailed(bank, monkeypatch):
    import httpx
    monkeypatch.setattr(httpx.Client, "send", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network used")))
    client, store, _ = bank
    service.create_invoice(client, store, BANK, dict(ARGS))


def test_mark_paid_then_ledger(bank):
    client, store, _ = bank
    inv_id = service.create_invoice(client, store, BANK, dict(ARGS))["invoice"]["invoice_id"]
    paid = service.mark_paid(client, store, {"invoice_id": inv_id, "note": "bank transfer, ref INV-0001"})
    assert paid["invoice"]["status"] == "paid" and paid["invoice"]["amount_paid"] == "$2,400.00"
    with pytest.raises(ValidationError):
        service.mark_paid(client, store, {"invoice_id": inv_id})
    assert "Paid" in service.ledger_text(store) and "$2,400.00" in service.ledger_text(store)


def test_bank_details_are_required_before_issuing(tmp_path):
    store, s = Store.memory(), dataclasses.replace(BANK, bank_account_number="")
    with pytest.raises(StripeError, match="bank details"):
        service.create_invoice(BankClient(store, s, tmp_path), store, s, dict(ARGS))


def test_risk_checks_see_bank_history(bank):
    client, store, _ = bank
    service.create_invoice(client, store, BANK, dict(ARGS))
    flags = risk.assess(store, BANK, customer_email=ARGS["customer_email"], customer_name="Acme Studio",
                        amount_minor=240000, currency="usd", client=client)
    assert any(f["check"] == "duplicate" for f in flags)
    other = risk.assess(store, BANK, customer_email="billing@acrnestudio.example.com", customer_name="Acme Studio",
                        amount_minor=240000, currency="usd", client=client)
    assert {"lookalike_domain", "impersonation"} <= {f["check"] for f in other}


def test_changed_payout_details_are_flagged_on_the_next_invoice(bank):
    client, store, _ = bank
    service.create_invoice(client, store, BANK, dict(ARGS))
    assert risk.payout_change(store, BANK) == []                       # same details: quiet
    swapped = dataclasses.replace(BANK, bank_account_number="9999888877")
    flags = risk.payout_change(store, swapped)
    assert flags and flags[0]["severity"] == "high" and "ends 8877" in flags[0]["message"]
    assert payout_fingerprint(swapped) != payout_fingerprint(BANK)
    assert "0123456789" not in (store.get_meta("payout_fp") or "")       # the log never holds the account number


def test_approval_prompt_says_bank_transfer():
    d = gate.decide("obol_create_invoice", dict(ARGS), mode="bank", allow_live=False, unattended=False,
                    summary=lambda: gate.describe_create(dict(ARGS), "usd", bank=True), assess=lambda: [])
    assert d["action"] == "approve" and "BANK TRANSFER" in d["message"] and "ISSUE a $2,400.00 bank-transfer invoice" in d["message"]
    assert gate.decide("obol_mark_paid", {"invoice_id": "in_bank1234567"}, mode="bank", allow_live=False, unattended=True,
                       summary=lambda: "", assess=lambda: [])["action"] == "block"   # scheduled runs can't mark paid


def test_pdf_escapes_text():
    pdf = simple_pdf([("F1", 11, "Acme (Studio) \\ test")])
    assert b"Acme \\(Studio\\) \\\\ test" in pdf


def test_mark_paid_on_stripe_is_paid_out_of_band(fake, client, store):
    inv_id = service.create_invoice(client, store, Settings(), {**ARGS})["invoice"]["invoice_id"]
    out = service.mark_paid(client, store, {"invoice_id": inv_id})
    assert out["invoice"]["status"] == "paid"
