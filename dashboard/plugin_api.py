"""Obol dashboard backend, mounted at /api/plugins/obol/.

Reads the same per-profile ledger the tools write. Only /sync talks to Stripe; every other
route answers from the local cache, so the tab stays fast and works offline.
Handlers are plain ``def`` so FastAPI runs them in a worker thread (never on the event loop).
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException

# The dashboard imports this file on its own (not as part of the plugin package), so make the
# shared library importable. Only src/ is added: it contains nothing but obol_lib.
_SRC = str(Path(__file__).resolve().parents[1] / "src")
if _SRC not in sys.path:
    sys.path.append(_SRC)

from obol_lib import money, runtime, service  # noqa: E402
from obol_lib.store import display_status  # noqa: E402
from obol_lib.stripe_client import StripeError, key_mode  # noqa: E402

router = APIRouter()


def _settings() -> service.Settings:
    from hermes_cli.config import load_config_readonly
    return runtime.settings_from_config(load_config_readonly())


def _mode() -> str:
    try:
        return key_mode(runtime.api_key())
    except Exception:
        return "missing"


def _livemode(mode: str) -> Optional[bool]:
    return mode == "live" if mode in ("test", "live") else None


@router.get("/status")
def status() -> dict[str, Any]:
    settings = _settings()
    last = runtime.store().get_meta("last_sync")
    return {"mode": _mode(), "allow_live": settings.allow_live,
            "last_sync": int(last) if last else None, "now": int(time.time())}


@router.get("/summary")
def summary() -> dict[str, Any]:
    mode = _mode()
    totals = runtime.store().summary(livemode=_livemode(mode))
    return {"mode": mode, "currencies": [
        {"currency": cur, **t, **{f"{k}_fmt": money.fmt(t[k], cur) for k in ("outstanding", "overdue", "paid", "draft")}}
        for cur, t in sorted(totals.items(), key=lambda kv: -(kv[1]["outstanding"] + kv[1]["paid"]))]}


@router.get("/invoices")
def invoices(status: Optional[str] = None, limit: int = 60) -> dict[str, Any]:
    if status is not None and status not in service.LIST_STATUSES:
        raise HTTPException(400, f"status must be one of {', '.join(service.LIST_STATUSES)}")
    now = time.time()
    store = runtime.store()
    rows = store.invoices(status=status, livemode=_livemode(_mode()), limit=max(1, min(limit, 200)))
    risk = store.risk(r["id"] for r in rows)
    out = []
    for r in rows:
        v = service.view(r, now)
        out.append({**v, "status": display_status(r, now), "amount_due_minor": r["amount_due"],
                    "created": r.get("created"), "due_ts": r.get("due_date"), "description": r.get("description"),
                    "risk": risk.get(r["id"], []),
                    "radar_risk_level": r.get("radar_risk_level"), "radar_risk_score": r.get("radar_risk_score"),
                    "disputed": bool(r.get("disputed")), "dispute_status": r.get("dispute_status"),
                    "dispute_reason": r.get("dispute_reason")})
    return {"invoices": out}


SECURITY_LABELS = {
    "prompt_injection": "Prompt injection", "lookalike_domain": "Lookalike domain", "impersonation": "Impersonation",
    "contact_change": "Changed contact details", "duplicate": "Possible duplicate", "unusual_amount": "Unusual amount",
    "payment_risk": "Fraud risk", "dispute": "Dispute", "live_key": "Live key refused",
    "unattended_write": "Unattended write refused",
}


@router.get("/security")
def security(days: int = 30, limit: int = 200) -> dict[str, Any]:
    store = runtime.store()
    events = store.security_events(limit=max(1, min(limit, 1000)))
    invoice_ids = {e["invoice_id"] for e in events if e.get("invoice_id")}
    rows = {i: store.get(i) for i in invoice_ids}
    now = int(time.time())
    since = now - max(1, min(days, 90)) * 86400
    by_type: dict[str, int] = {}
    by_outcome: dict[str, int] = {"flagged": 0, "withheld": 0, "blocked": 0}
    timeline: dict[str, dict[str, int]] = {}
    out = []
    for e in events:
        check = e["check_name"]
        by_type[check] = by_type.get(check, 0) + 1
        by_outcome[e["outcome"]] = by_outcome.get(e["outcome"], 0) + 1
        if e["at"] >= since:
            day = time.strftime("%Y-%m-%d", time.gmtime(e["at"]))
            timeline.setdefault(day, {})[check] = timeline.setdefault(day, {}).get(check, 0) + 1
        inv = rows.get(e.get("invoice_id")) if e.get("invoice_id") else None
        out.append({
            "seq": e["seq"], "at": e["at"], "check": check, "label": SECURITY_LABELS.get(check, check),
            "severity": e["severity"], "outcome": e["outcome"], "detail": e["detail"],
            "invoice_id": e.get("invoice_id"),
            "invoice_number": inv.get("number") if inv else None,
            "customer": (inv.get("customer_name") or inv.get("customer_email")) if inv else None,
            "invoice_status": display_status(inv, now) if inv else None,
            "payment_link": inv.get("hosted_url") if inv else None,
        })
    days_list = [time.strftime("%Y-%m-%d", time.gmtime(now - i * 86400)) for i in range(min(days, 90) - 1, -1, -1)]
    return {
        "events": out,
        "by_type": [{"check": k, "label": SECURITY_LABELS.get(k, k), "count": v}
                    for k, v in sorted(by_type.items(), key=lambda kv: -kv[1])],
        "by_outcome": by_outcome,
        "timeline": [{"day": d, "counts": timeline.get(d, {})} for d in days_list],
        "integrity": {"activity": store.verify_chain("events"), "security": store.verify_chain("security_events")},
    }


@router.get("/events")
def events(limit: int = 25) -> dict[str, Any]:
    return {"events": runtime.store().events(limit)}


@router.post("/sync")
def sync() -> dict[str, Any]:
    try:
        with runtime.make_client(_settings()) as client:
            result = service.sync(client, runtime.store())
    except StripeError as exc:
        raise HTTPException(502 if exc.kind in ("network", "timeout", "api_error") else 400, str(exc)) from None
    runtime.store().log("synced", None, f"{result['synced']} invoices synced")
    return result
