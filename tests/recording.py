"""Record / replay real Stripe test-mode traffic for Obol's service flow.

``scripts/record_stripe_fixtures.py`` runs FLOW against Stripe test mode through
``RecordingTransport`` and writes ``tests/fixtures/stripe/flow.json``.
``tests/test_recorded_responses.py`` replays that file through ``ReplayTransport`` and runs
the same FLOW, so the parsing and state handling are checked against real Stripe payloads.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Callable

import httpx

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "stripe" / "flow.json"

# Fields that could identify the recording account or act as bearer links, replaced on save.
_SCRUB_KEYS = {
    "account_name": "Obol Test Account",
    "statement_descriptor": None,
    "footer": None,
    "account_tax_ids": None,
    "fingerprint": "REDACTED",        # card fingerprint (stable card identifier)
    "receipt_number": None,
}
_URL_RE = re.compile(r"https://(invoice|pay)\.stripe\.com/[^\s\"']+")


def scrub(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in _SCRUB_KEYS:
                out[k] = _SCRUB_KEYS[k]
            else:
                out[k] = scrub(v)
        return out
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    if isinstance(obj, str):
        return _URL_RE.sub(lambda m: f"https://{m.group(1)}.stripe.com/REDACTED", obj)
    return obj


def _env_transport() -> httpx.HTTPTransport:
    """A transport that honours HTTPS_PROXY and SSL_CERT_FILE like a default httpx client does."""
    import os
    import ssl

    import certifi
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or certifi.where())
    return httpx.HTTPTransport(proxy=proxy, verify=ctx)


class RecordingTransport(httpx.BaseTransport):
    def __init__(self, inner: httpx.BaseTransport | None = None) -> None:
        self._inner = inner or _env_transport()
        self.exchanges: list[dict] = []

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        response = self._inner.handle_request(request)
        response.read()
        try:
            body = response.json()
        except ValueError:
            body = {"_raw": response.text[:2000]}
        self.exchanges.append({"method": request.method, "path": request.url.path,
                               "status": response.status_code, "body": scrub(body)})
        return httpx.Response(response.status_code, headers=response.headers, content=response.content,
                              request=request)


class ReplayTransport(httpx.BaseTransport):
    """Serves recorded exchanges in order; fails loudly if the client's calls drift from the recording."""

    def __init__(self, exchanges: list[dict]) -> None:
        self._queue = list(exchanges)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if not self._queue:
            raise AssertionError(f"unexpected extra request {request.method} {request.url.path}")
        ex = self._queue.pop(0)
        assert (request.method, request.url.path) == (ex["method"], ex["path"]), \
            f"call order drifted: got {request.method} {request.url.path}, recorded {ex['method']} {ex['path']}"
        return httpx.Response(ex["status"], json=ex["body"], request=request)

    @property
    def remaining(self) -> int:
        return len(self._queue)


def run_flow(client: Any, store: Any, settings: Any, email: str, check: Callable[[str, Any], None]) -> None:
    """The scripted flow. ``check(step, result)`` lets the replay test assert on each step."""
    from obol_lib import service
    from obol_lib.stripe_client import StripeError

    created = service.create_invoice(client, store, settings, {
        "customer_email": email, "customer_name": "Pinemoor Labs",
        "line_items": [{"description": "October consulting", "amount": 1200}],
        "memo": "Obol fixture recording"})
    check("create_draft", created)
    inv_id = created["invoice"]["invoice_id"]
    check("send", service.send_invoice(client, store, {"invoice_id": inv_id}))
    check("get", service.get_invoice(client, store, {"invoice_id": inv_id}))
    check("list", service.list_invoices(client, store, {"limit": 5}))
    second = service.create_invoice(client, store, settings, {
        "customer_email": email, "line_items": [{"description": "Duplicate to void", "amount": 50}], "send": True})
    check("void", service.void_invoice(client, store, {"invoice_id": second["invoice"]["invoice_id"]}))
    check("events", client.list_events(types=["customer.updated"], created_gte=int(time.time()) - 86400, limit=3))
    try:
        service.get_invoice(client, store, {"invoice_id": "in_0000000000obolmissing"})
    except StripeError as exc:
        check("not_found", exc)


def save(exchanges: list[dict]) -> None:
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps({"recorded_at": int(time.time()), "api_version": "2024-06-20",
                                   "source": "Stripe test mode", "exchanges": exchanges}, indent=1))
