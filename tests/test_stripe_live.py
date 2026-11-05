"""End-to-end tests against the real Stripe API, in TEST mode only.

Skipped unless a Stripe test key is in the environment, as ``STRIPE_API_KEY`` (the name Obol
uses) or ``STRIPE_SECRET_KEY`` (the conventional name in many environments). A live key is
refused outright, so these tests can never bill anyone.

Each run uses a fresh customer email and removes what it created: drafts are deleted, sent
invoices are voided, and the customer is deleted at the end.

    STRIPE_API_KEY=sk_test_... python -m pytest tests/test_stripe_live.py -v
"""

from __future__ import annotations

import os
import uuid

import pytest

from obol_lib import service
from obol_lib.service import Settings
from obol_lib.store import Store
from obol_lib.stripe_client import StripeClient, StripeError, key_mode

KEY = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")

if key_mode(KEY) == "live":
    pytest.skip("refusing to run live-API tests with a LIVE Stripe key; use sk_test_/rk_test_",
                allow_module_level=True)
if key_mode(KEY) != "test":
    pytest.skip("no Stripe test key in STRIPE_API_KEY / STRIPE_SECRET_KEY", allow_module_level=True)

S = Settings()


@pytest.fixture(scope="module")
def client():
    with StripeClient(KEY) as c:
        assert c.mode == "test"
        yield c


@pytest.fixture(scope="module")
def email(client):
    addr = f"obol-live-{uuid.uuid4().hex[:12]}@example.com"
    yield addr
    customer = client.find_customer_by_email(addr)
    if customer is not None:
        try:
            client.request("DELETE", f"/v1/customers/{customer['id']}")
        except StripeError:
            pass


@pytest.fixture
def store():
    return Store.memory()


def _args(email: str, **extra) -> dict:
    return {"customer_email": email, "customer_name": "Obol Live Test",
            "line_items": [{"description": "Live test consulting", "amount": "12.34", "quantity": 2}],
            "memo": "Automated Obol test", **extra}


def test_draft_roundtrip_and_delete(client, store, email):
    out = service.create_invoice(client, store, S, _args(email))
    inv = out["invoice"]
    assert out["created"] and inv["status"] == "draft"
    assert inv["amount_due"] == "$24.68"
    assert inv["invoice_id"].startswith("in_")

    got = service.get_invoice(client, store, {"invoice_id": inv["invoice_id"]})
    assert got["invoice"]["invoice_id"] == inv["invoice_id"]

    gone = service.void_invoice(client, store, {"invoice_id": inv["invoice_id"]})
    assert gone["deleted"] is True
    with pytest.raises(StripeError) as exc:
        client.get_invoice(inv["invoice_id"])
    assert exc.value.kind == "not_found"


def test_send_remind_void(client, store, email):
    out = service.create_invoice(client, store, S, _args(email, send=True))
    inv_id = out["invoice"]["invoice_id"]
    try:
        assert out["sent"] and out["invoice"]["status"] == "open"
        assert out["payment_link"].startswith("https://invoice.stripe.com/")

        by_email = service.get_invoice(client, store, {"customer_email": email})
        assert by_email["invoice"] is not None

        reminded = service.send_reminder(client, store, {"invoice_id": inv_id})
        assert reminded["reminded"]

        listed = service.list_invoices(client, store, {"customer_email": email, "status": "open"})
        assert inv_id in [r["invoice_id"] for r in listed["invoices"]]
    finally:
        voided = service.void_invoice(client, store, {"invoice_id": inv_id, "reason": "live test"})
    assert voided["voided"] and voided["invoice"]["status"] == "void"


def test_bad_key_is_auth_error():
    with StripeClient("sk_test_obviouslynotarealkey000000") as c:
        with pytest.raises(StripeError) as exc:
            c.list_invoices(limit=1)
    assert exc.value.kind == "auth"
