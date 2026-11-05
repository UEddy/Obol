import pytest

from obol_lib import service
from obol_lib.service import Settings, ValidationError
from obol_lib.stripe_client import StripeError

S = Settings()
ACME = {"customer_email": "billing@acme.test", "customer_name": "Acme Co",
        "line_items": [{"description": "October consulting", "amount": 1200}], "memo": "Thanks!"}


def test_create_draft(fake, client, store):
    out = service.create_invoice(client, store, S, ACME)
    inv = out["invoice"]
    assert out["created"] and inv["status"] == "draft"
    assert inv["amount_due"] == "$1,200.00" and inv["customer"] == "Acme Co"
    assert fake.sent == [] and "obol_send_invoice" in out["next_step"]
    assert store.events()[0]["kind"] == "created"


def test_create_and_send(fake, client, store):
    out = service.create_invoice(client, store, S, {**ACME, "send": True})
    assert out["sent"] and out["payment_link"].startswith("https://invoice.stripe.com/")
    assert out["invoice"]["status"] == "open" and len(fake.sent) == 1


def test_reuses_existing_customer(fake, client, store):
    service.create_invoice(client, store, S, ACME)
    service.create_invoice(client, store, S, ACME)
    assert len(fake.customers) == 1 and len(fake.invoices) == 2


def test_multiple_items_and_quantity(fake, client, store):
    args = {**ACME, "line_items": [{"description": "Design", "amount": "99.99", "quantity": 3},
                                   {"description": "Hosting", "amount": 20}]}
    out = service.create_invoice(client, store, S, args)
    assert out["invoice"]["amount_due"] == "$319.97"


@pytest.mark.parametrize("patch", [
    {"customer_email": "not-an-email"}, {"line_items": []}, {"line_items": [{"description": "x", "amount": -1}]},
    {"line_items": [{"amount": 5}]}, {"line_items": [{"description": "x", "amount": 5, "quantity": 0}]},
    {"line_items": [{"description": "x", "amount": 5, "quantity": True}]},
    {"currency": "kwd"}, {"days_until_due": 400}, {"days_until_due": "soon"},
])
def test_validation_happens_before_any_call(fake, client, store, patch):
    with pytest.raises((ValidationError, ValueError)):
        service.create_invoice(client, store, S, {**ACME, **patch})
    assert fake.calls == []


def test_failed_item_cleans_up_draft(fake, client, store):
    fake.fail_queue.append(("/v1/invoiceitems", 400))
    with pytest.raises(StripeError):
        service.create_invoice(client, store, S, ACME)
    assert fake.invoices == {}
    assert ("DELETE", next(p for m, p in fake.calls if m == "DELETE")) in fake.calls


def test_send_draft_finalizes(fake, client, store):
    draft = service.create_invoice(client, store, S, ACME)["invoice"]
    out = service.send_invoice(client, store, {"invoice_id": draft["invoice_id"]})
    assert out["invoice"]["status"] == "open" and out["invoice"]["number"].startswith("OBOL-")


def test_cannot_send_paid(fake, client, store):
    inv = service.create_invoice(client, store, S, {**ACME, "send": True})["invoice"]
    fake.pay(inv["invoice_id"])
    with pytest.raises(ValidationError, match="paid"):
        service.send_invoice(client, store, {"invoice_id": inv["invoice_id"]})


def test_bad_invoice_id_rejected_locally(fake, client, store):
    for bad in ("", "cus_123", "in_", "in_../../x", None):
        with pytest.raises(ValidationError):
            service.get_invoice(client, store, {"invoice_id": bad})
    assert fake.calls == []


def test_get_invoice_tracks_payment(fake, client, store):
    inv = service.create_invoice(client, store, S, {**ACME, "send": True})["invoice"]
    fake.pay(inv["invoice_id"])
    got = service.get_invoice(client, store, {"invoice_id": inv["invoice_id"]})["invoice"]
    assert got["status"] == "paid" and got["amount_paid"] == "$1,200.00" and "paid_at" in got
    assert [e["kind"] for e in store.events()][:1] == ["paid"]


def test_get_invoice_by_email(fake, client, store):
    service.create_invoice(client, store, S, {**ACME, "send": True})
    got = service.get_invoice(client, store, {"customer_email": "BILLING@acme.test"})
    assert got["invoice"]["customer_email"] == "billing@acme.test"
    assert service.get_invoice(client, store, {"customer_email": "x@y.test"})["invoice"] is None


def test_overdue_detection(fake, client, store):
    fake.now -= 30 * 86400  # issued a month ago, due after 14 days -> overdue now
    service.create_invoice(client, store, S, {**ACME, "send": True})
    out = service.list_invoices(client, store, {"status": "overdue"})
    assert out["count"] == 1 and out["invoices"][0]["status"] == "overdue"
    assert out["invoices"][0]["days_overdue"] >= 15
    assert out["totals"]["usd"]["overdue"] == "$1,200.00"


def test_reminder_and_void(fake, client, store):
    inv = service.create_invoice(client, store, S, {**ACME, "send": True})["invoice"]
    service.send_reminder(client, store, {"invoice_id": inv["invoice_id"]})
    assert len(fake.sent) == 2
    out = service.void_invoice(client, store, {"invoice_id": inv["invoice_id"], "reason": "duplicate"})
    assert out["invoice"]["status"] == "void"
    with pytest.raises(ValidationError):
        service.send_reminder(client, store, {"invoice_id": inv["invoice_id"]})


def test_void_draft_deletes(fake, client, store):
    inv = service.create_invoice(client, store, S, ACME)["invoice"]
    out = service.void_invoice(client, store, {"invoice_id": inv["invoice_id"]})
    assert out["deleted"] and store.get(inv["invoice_id"]) is None


def test_sync_paginates(fake, client, store):
    for i in range(3):
        service.create_invoice(client, store, S, {**ACME, "memo": str(i)})
    store2 = type(store).memory()
    assert service.sync(client, store2)["synced"] == 3 and len(store2.invoices()) == 3


def test_ledger_text(fake, client, store):
    assert "No invoices yet" in service.ledger_text(store)
    service.create_invoice(client, store, S, {**ACME, "send": True})
    text = service.ledger_text(store, livemode=False)
    assert "TEST MODE" in text and "$1,200.00" in text and "OPEN" in text


def test_list_without_client_reads_cache(fake, client, store):
    service.create_invoice(client, store, S, ACME)
    out = service.list_invoices(None, store, {"status": "draft"})
    assert out["count"] == 1 and out["synced_from_stripe"] is None
    with pytest.raises(ValidationError):
        service.list_invoices(None, store, {"status": "bogus"})


def test_sync_includes_test_clock_invoices_in_test_mode(fake, client, store):
    """Stripe hides test-clock customers and invoices from normal lists; test-mode sync walks the clocks."""
    clock = client.request("POST", "/v1/test_helpers/test_clocks", data={"name": "demo", "frozen_time": fake.now})
    cus = client.request("POST", "/v1/customers", data={"email": "ap@fernhill.example.com", "name": "Fernhill Books",
                                                       "test_clock": clock["id"]})
    inv = client.create_invoice(customer=cus["id"], currency="usd", days_until_due=14, description=None,
                                metadata={}, idempotency_key="k-inv")
    assert client.list_invoices()["data"] == []            # hidden from the normal list, as on Stripe
    assert service.sync(client, store)["synced"] == 1
    assert store.get(inv["id"])["customer_name"] == "Fernhill Books"
