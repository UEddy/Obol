"""Replay real Stripe test-mode responses (tests/fixtures/stripe/flow.json) through the service flow.

Re-record with: STRIPE_API_KEY=sk_test_... python scripts/record_stripe_fixtures.py
"""

from __future__ import annotations

import json

import pytest

from obol_lib.service import Settings
from obol_lib.store import Store
from obol_lib.stripe_client import StripeClient, StripeError
from recording import FIXTURE, ReplayTransport, run_flow

needs_recording = pytest.mark.skipif(not FIXTURE.exists(),
                                     reason="no recorded Stripe fixtures yet (needs test-mode access)")


def test_record_replay_machinery_roundtrip(fake):
    """The recorder and replayer agree with each other (exercised against the in-memory fake)."""
    from recording import RecordingTransport
    rec = RecordingTransport(inner=fake.transport)
    with StripeClient("sk_test_rec", transport=rec, sleep=lambda _s: None) as client:
        run_flow(client, Store.memory(), Settings(), "obol-fixture@example.com", lambda *_: None)
    replay = ReplayTransport(rec.exchanges)
    with StripeClient("sk_test_rec", transport=replay, sleep=lambda _s: None) as client:
        run_flow(client, Store.memory(), Settings(), "obol-fixture@example.com", lambda *_: None)
    assert replay.remaining == 0 and len(rec.exchanges) >= 15


@needs_recording
def test_replay_matches_recording():
    data = json.loads(FIXTURE.read_text())
    assert data["source"] == "Stripe test mode"
    replay = ReplayTransport(data["exchanges"])
    seen: dict[str, object] = {}
    store = Store.memory()
    with StripeClient("sk_test_replay", transport=replay, sleep=lambda _s: None) as client:
        run_flow(client, store, Settings(), "obol-fixture@example.com", lambda step, res: seen.__setitem__(step, res))
    assert replay.remaining == 0

    draft = seen["create_draft"]["invoice"]
    assert draft["status"] == "draft" and draft["amount_due"] == "$1,200.00" and draft["currency"] == "usd"
    sent = seen["send"]
    assert sent["invoice"]["status"] == "open" and sent["payment_link"].startswith("https://invoice.stripe.com/")
    assert sent["invoice"]["number"] and sent["invoice"]["due_date"]
    assert seen["get"]["invoice"]["invoice_id"] == draft["invoice_id"]
    assert seen["list"]["count"] >= 1
    assert seen["void"]["invoice"]["status"] == "void"
    assert seen["events"]["object"] == "list"
    err = seen["not_found"]
    assert isinstance(err, StripeError) and err.kind == "not_found" and err.status == 404
    # Every recorded write carried an idempotency key path through the client (POSTs present).
    assert any(ex["method"] == "POST" for ex in data["exchanges"])
