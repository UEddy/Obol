"""Payment-side risk: Stripe Radar outcome and disputes on paid invoices (read-only)."""

from obol_lib import service
from obol_lib.service import Settings

ARGS = {"customer_email": "finance@lumenhealth.example.com", "customer_name": "Lumen Health", "send": True,
        "line_items": [{"description": "Marketing site design", "amount": 2700}]}


def _paid(fake, client, store, **kw):
    inv = service.create_invoice(client, store, Settings(), ARGS)["invoice"]["invoice_id"]
    fake.pay(inv, **kw)
    service.sync(client, store)
    return inv


def test_normal_payment_records_radar_level_without_noise(fake, client, store):
    inv = _paid(fake, client, store)
    row = store.get(inv)
    assert row["radar_risk_level"] == "normal" and row["radar_risk_score"] == 12 and row["disputed"] == 0
    assert store.security_events() == []


def test_elevated_radar_risk_is_flagged(fake, client, store):
    inv = _paid(fake, client, store, risk_level="elevated", risk_score=72)
    ev = store.security_events()[0]
    assert ev["check_name"] == "payment_risk" and ev["severity"] == "medium" and ev["invoice_id"] == inv
    assert "elevated" in ev["detail"] and "score 72" in ev["detail"]


def test_dispute_found_on_a_later_sync_once(fake, client, store):
    inv = _paid(fake, client, store)
    fake.dispute(inv)
    store._conn.execute("UPDATE invoices SET payment_checked_at = payment_checked_at - 90000"); store._conn.commit()
    service.sync(client, store)
    row = store.get(inv)
    assert row["disputed"] == 1 and row["dispute_reason"] == "fraudulent" and row["dispute_status"] == "needs_response"
    disputes = [e for e in store.security_events() if e["check_name"] == "dispute"]
    assert len(disputes) == 1 and disputes[0]["invoice_id"] == inv
    store._conn.execute("UPDATE invoices SET payment_checked_at = payment_checked_at - 90000"); store._conn.commit()
    service.sync(client, store)
    assert len([e for e in store.security_events() if e["check_name"] == "dispute"]) == 1


def test_payment_checks_are_read_only(fake, client, store):
    _paid(fake, client, store)
    writes = [c for c in fake.calls if c[0] != "GET" and ("charges" in c[1] or "disputes" in c[1])]
    assert writes == []


def test_stripe_errors_leave_it_for_the_next_sync(fake, client, store):
    inv = service.create_invoice(client, store, Settings(), ARGS)["invoice"]["invoice_id"]
    fake.pay(inv)
    fake.fail_queue.append(("/v1/charges", 404))
    service.sync(client, store)
    assert store.get(inv)["payment_checked_at"] is None
    service.sync(client, store)
    assert store.get(inv)["radar_risk_level"] == "normal"
