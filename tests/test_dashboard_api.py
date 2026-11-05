"""Dashboard backend routes, served through FastAPI's TestClient against the fake Stripe."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from obol_lib import runtime, service  # noqa: E402
from obol_lib.stripe_client import StripeClient  # noqa: E402

API_FILE = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"


@pytest.fixture
def api(monkeypatch, fake, store):
    spec = importlib.util.spec_from_file_location("obol_dashboard_api_under_test", API_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "_settings", lambda: service.Settings())
    monkeypatch.setattr(runtime, "store", lambda: store)
    monkeypatch.setattr(runtime, "api_key", lambda: "sk_test_dash")
    monkeypatch.setattr(runtime, "client_factory",
                        lambda key, **kw: StripeClient(key, transport=fake.transport, sleep=lambda _s: None, **kw))
    app = FastAPI()
    app.include_router(mod.router, prefix="/api/plugins/obol")
    return TestClient(app)


def _seed(fake, store):
    with StripeClient("sk_test_dash", transport=fake.transport) as c:
        a = service.create_invoice(c, store, service.Settings(), {
            "customer_email": "a@pinemoor.test", "customer_name": "Pinemoor",
            "line_items": [{"description": "Work", "amount": 1200}], "send": True})
        b = service.create_invoice(c, store, service.Settings(), {
            "customer_email": "b@globex.test", "line_items": [{"description": "Retainer", "amount": 800}], "send": True})
    return a["invoice"]["invoice_id"], b["invoice"]["invoice_id"]


def test_status_and_empty_summary(api):
    st = api.get("/api/plugins/obol/status").json()
    assert st["mode"] == "test" and st["allow_live"] is False and st["last_sync"] is None
    assert api.get("/api/plugins/obol/summary").json()["currencies"] == []


def test_summary_invoices_and_sync_picks_up_payment(api, fake, store):
    a, b = _seed(fake, store)
    fake.pay(a)
    assert api.post("/api/plugins/obol/sync").json() == {"synced": 2}
    summary = api.get("/api/plugins/obol/summary").json()["currencies"][0]
    assert summary["paid_fmt"] == "$1,200.00" and summary["outstanding_fmt"] == "$800.00"
    paid = api.get("/api/plugins/obol/invoices", params={"status": "paid"}).json()["invoices"]
    assert [i["invoice_id"] for i in paid] == [a] and paid[0]["risk"] == []
    store.set_risk(b, [{"check": "duplicate", "severity": "high", "message": "dup"}])
    open_rows = api.get("/api/plugins/obol/invoices", params={"status": "open"}).json()["invoices"]
    assert open_rows[0]["risk"][0]["check"] == "duplicate"
    kinds = [e["kind"] for e in api.get("/api/plugins/obol/events").json()["events"]]
    assert "paid" in kinds and kinds[0] == "synced"


def test_bad_status_is_400(api):
    assert api.get("/api/plugins/obol/invoices", params={"status": "nope"}).status_code == 400


def test_sync_errors_are_reported(api, fake, monkeypatch):
    monkeypatch.setattr(runtime, "api_key", lambda: None)
    r = api.post("/api/plugins/obol/sync")
    assert r.status_code == 400 and "STRIPE_API_KEY" in r.json()["detail"]
    monkeypatch.setattr(runtime, "api_key", lambda: "sk_test_dash")
    fake.timeout_queue.extend(["/v1/invoices"] * 3)
    r = api.post("/api/plugins/obol/sync")
    assert r.status_code == 502


def test_security_route_groups_links_and_verifies(api, fake, store):
    a, _ = _seed(fake, store)
    store.record_security("lookalike_domain", "high", "flagged", "pinernoor.example.com looks like pinemoor.example.com", ref="fp")
    store.link_security_ref("fp", a)
    store.record_security("prompt_injection", "high", "withheld", "intake (email): ignore previous instructions")
    store.record_security("live_key", "high", "blocked", "obol_send_invoice: live key refused")
    sec = api.get("/api/plugins/obol/security").json()
    assert sec["by_outcome"] == {"flagged": 1, "withheld": 1, "blocked": 1}
    assert {t["check"] for t in sec["by_type"]} == {"lookalike_domain", "prompt_injection", "live_key"}
    linked = next(e for e in sec["events"] if e["check"] == "lookalike_domain")
    assert linked["invoice_id"] == a and linked["invoice_number"] and linked["customer"] == "Pinemoor"
    assert len(sec["timeline"]) == 30 and sum(sum(d["counts"].values()) for d in sec["timeline"]) == 3
    assert sec["integrity"]["activity"]["ok"] and sec["integrity"]["security"]["ok"]
    store._conn.execute("UPDATE security_events SET outcome = 'ignored' WHERE check_name = 'live_key'"); store._conn.commit()
    assert api.get("/api/plugins/obol/security").json()["integrity"]["security"]["ok"] is False


def test_security_route_names_guarded_tools(api, store):
    store.record_security("guard_address_poisoning", "high", "flagged", "agentwalletapi_transfer_send: imitates",
                          ref="guard:agentwalletapi_transfer_send:abc")
    ev = api.get("/api/plugins/obol/security").json()["events"][0]
    assert ev["tool"] == "agentwalletapi_transfer_send" and ev["label"] == "Guard: address poisoning"
