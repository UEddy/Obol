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
    return {"mode": _mode(), "approval": settings.approval, "allow_live": settings.allow_live,
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
    rows = runtime.store().invoices(status=status, livemode=_livemode(_mode()), limit=max(1, min(limit, 200)))
    out = []
    for r in rows:
        v = service.view(r, now)
        out.append({**v, "status": display_status(r, now), "amount_due_minor": r["amount_due"],
                    "created": r.get("created"), "due_ts": r.get("due_date"), "description": r.get("description")})
    return {"invoices": out}


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
    runtime.store().log("synced", None, f"{result['synced']} invoices from Stripe")
    return result
