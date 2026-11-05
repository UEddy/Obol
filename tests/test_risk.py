import dataclasses
import time

from obol_lib import risk, service
from obol_lib.service import Settings
from obol_lib.stripe_client import StripeClient

S = Settings()
PINEMOOR = {"customer_email": "billing@pinemoor.test", "customer_name": "Pinemoor Labs",
        "line_items": [{"description": "October consulting", "amount": 1200}], "send": True}


def _assess(store, client=None, settings=S, amount=120000, email="billing@pinemoor.test", name="Pinemoor Labs", **kw):
    return risk.assess(store, settings, customer_email=email, customer_name=name, amount_minor=amount,
                       currency="usd", client=client, **kw)


def checks(flags):
    return {f["check"] for f in flags}


def test_clean_first_invoice(fake, client, store):
    assert _assess(store, client) == []


def test_duplicate_within_window(fake, client, store):
    service.create_invoice(client, store, S, PINEMOOR)
    flags = _assess(store, client)
    assert checks(flags) == {"duplicate"} and flags[0]["severity"] == "high"
    assert "$1,200.00" in flags[0]["message"]
    assert _assess(store, client, amount=120100) == []          # different amount
    assert _assess(store, client, settings=dataclasses.replace(S, risk_duplicate_window_days=0)) == []


def test_duplicate_outside_window_is_quiet(fake, client, store):
    fake.now -= 40 * 86400
    service.create_invoice(client, store, S, PINEMOOR)
    assert "duplicate" not in checks(_assess(store, client))


def test_voided_invoice_is_not_a_duplicate(fake, client, store):
    inv = service.create_invoice(client, store, S, PINEMOOR)["invoice"]
    service.void_invoice(client, store, {"invoice_id": inv["invoice_id"]})
    assert "duplicate" not in checks(_assess(store, client))


def test_existing_invoice_excludes_itself(fake, client, store):
    inv = service.create_invoice(client, store, S, PINEMOOR)["invoice"]
    assert _assess(store, client, exclude_invoice_id=inv["invoice_id"]) == []


def test_unusual_amount_needs_history(fake, client, store):
    for amt in (1000, 1100, 1200):
        fake.now -= 40 * 86400
        service.create_invoice(client, store, S, {**PINEMOOR, "line_items": [{"description": "m", "amount": amt}]})
    flags = _assess(store, client, amount=900000)
    assert checks(flags) == {"unusual_amount"} and "8.2x" in flags[0]["message"] and flags[0]["severity"] == "medium"
    assert _assess(store, client, amount=300000) == []           # 2.7x average, under 3x
    assert _assess(store, client, amount=900000, settings=dataclasses.replace(S, risk_amount_min_history=5)) == []
    assert _assess(store, client, amount=900000, settings=dataclasses.replace(S, risk_amount_multiplier=0)) == []


def test_same_name_new_email(fake, client, store):
    service.create_invoice(client, store, S, PINEMOOR)
    flags = _assess(store, client, email="payments@pinemoor-billing.test", amount=5000)
    assert checks(flags) == {"impersonation", "lookalike_domain"}
    assert "billing@pinemoor.test" in next(f["message"] for f in flags if f["check"] == "impersonation")
    off = dataclasses.replace(S, risk_impersonation=False, risk_lookalike_domains=False)
    assert _assess(store, client, email="payments@pinemoor-billing.test", amount=5000, settings=off) == []
    # same organisation, another mailbox: not impersonation
    assert _assess(store, client, email="ap@pinemoor.test", amount=5000) == []


def test_stripe_customer_updated_event(fake, client, store):
    service.create_invoice(client, store, S, {**PINEMOOR, "line_items": [{"description": "m", "amount": 10}]})
    cus = next(iter(fake.customers))
    fake.customer_updated(cus, {"email": "old@pinemoor.test"}, at=int(time.time()) - 2 * 86400)
    flags = _assess(store, client, amount=5000)
    msg = next(f["message"] for f in flags if f["check"] == "contact_change")
    assert "email changed in Stripe 2 days ago" in msg and "old@pinemoor.test" in msg
    fake.events.clear()
    fake.customer_updated(cus, {"invoice_settings": {"default_payment_method": None}}, at=int(time.time()) - 3600)
    assert "invoice settings" in _assess(store, client, amount=5000)[0]["message"]


def test_old_or_irrelevant_events_ignored(fake, client, store):
    service.create_invoice(client, store, S, {**PINEMOOR, "line_items": [{"description": "m", "amount": 10}]})
    cus = next(iter(fake.customers))
    fake.customer_updated(cus, {"email": "old@pinemoor.test"}, at=int(time.time()) - 20 * 86400)
    fake.customer_updated(cus, {"metadata": {"x": "1"}})
    assert _assess(store, client, amount=5000) == []


def test_sees_invoices_made_outside_obol(fake, client, store):
    service.create_invoice(client, store, S, PINEMOOR)
    fresh = type(store).memory()  # empty cache: the check must refresh from Stripe
    assert "duplicate" in checks(_assess(fresh, client))


def test_stripe_failures_degrade_to_info(fake, store):
    service.create_invoice(StripeClient("sk_test_1", transport=fake.transport), store, S, PINEMOOR)
    fake.fail_queue.extend([("/v1/customers", 500)])
    flaky = StripeClient("sk_test_1", transport=fake.transport, max_retries=0)
    flags = _assess(store, flaky)
    assert "unavailable" in checks(flags) and "duplicate" in checks(flags)   # still runs on the cache


def test_fingerprint_stable_and_normalized():
    a = risk.create_fingerprint(PINEMOOR, "usd")
    b = risk.create_fingerprint({**PINEMOOR, "customer_email": " BILLING@pinemoor.test ", "currency": "USD",
                                 "line_items": [{"description": "October consulting", "amount": "1200.00"}]}, "usd")
    assert a == b and a != risk.create_fingerprint({**PINEMOOR, "send": False}, "usd")
    assert risk.create_fingerprint({**PINEMOOR, "line_items": [{"amount": "x"}]}, "usd") is None
