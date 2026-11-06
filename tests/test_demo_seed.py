"""`hermes obol demo`: a Stripe TEST account seeded so Obol can be tried in two minutes."""

from __future__ import annotations

import pytest

from obol_lib import demo_seed
from obol_lib.stripe_client import StripeError


class RecordingClient:
    """Answers the calls demo_seed makes, and records them."""

    def __init__(self, mode="test"):
        self.mode, self.calls, self.n = mode, [], 0

    def _id(self, p):
        self.n += 1
        return f"{p}_{self.n}"

    def request(self, method, path, params=None, data=None, idempotency_key=None):
        self.calls.append((method, path, dict(data or params or {})))
        if path.endswith("test_clocks") and method == "GET":
            return {"data": [{"id": "clock_old", "name": "obol-try Old 3d"}, {"id": "clock_video", "name": "obol-demo Video"}]}
        if path.endswith("test_clocks"):
            return {"id": self._id("clock")}
        if path == "/v1/customers":
            return {"id": self._id("cus")}
        if path.endswith("/attach"):
            return {"id": self._id("pm")}
        if path.endswith("/pay"):
            return {"id": path.split("/")[3], "status": "paid"}
        return {}

    def create_invoice(self, **kw):
        self.calls.append(("create_invoice", kw["customer"], kw))
        return {"id": self._id("in")}

    def add_invoice_item(self, **kw):
        self.calls.append(("item", kw["invoice"], kw))

    def finalize_invoice(self, inv_id, **kw):
        return {"id": inv_id, "status": "open"}

    def send_invoice(self, inv_id, **kw):
        return {"id": inv_id, "status": "open"}


def test_demo_refuses_anything_but_a_test_key():
    with pytest.raises(StripeError):
        demo_seed.seed(RecordingClient(mode="live"), say=lambda _m: None)


def test_demo_replaces_only_its_own_clocks_and_seeds_every_state():
    c = RecordingClient()
    made = demo_seed.seed(c, say=lambda _m: None)
    deleted = [p for m, p, _ in c.calls if m == "DELETE"]
    assert deleted == ["/v1/test_helpers/test_clocks/clock_old"]          # never the video's obol-demo clocks
    assert len(made) == len(demo_seed.BOOK)
    paid = [p for m, p, _ in c.calls if p.endswith("/pay")]
    assert len(paid) == sum(1 for b in demo_seed.BOOK if b[5])
    states = {("paid" if b[5] else "overdue" if b[2] > b[3] else "open") for b in demo_seed.BOOK}
    assert states == {"paid", "open", "overdue"}
    emails = {d.get("email", "") for m, p, d in c.calls if p == "/v1/customers"}
    assert emails and all(e.endswith(".example.com") for e in emails)


def test_try_it_scam_is_a_lookalike_of_a_seeded_client():
    from obol_lib import security
    billed = {b[1] for b in demo_seed.BOOK if b[5]}
    assert "billing@acmestudio.example.com" in billed and "acrnestudio" in demo_seed.TRY
    assert security.lookalike_findings("billing@acrnestudio.example.com", billed)
