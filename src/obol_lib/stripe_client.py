"""Minimal, dependency-free (httpx only) Stripe REST client for the invoice endpoints Obol uses.

Reliability rules:
* every POST carries an ``Idempotency-Key`` that is reused across retries, so a timeout
  followed by a retry can never create a second invoice or send a second email;
* 429 / 5xx / connection errors retry with exponential backoff (bounded);
* the API version is pinned so Stripe-side defaults cannot change under us;
* live keys are refused unless the operator explicitly allowed live mode.
"""

from __future__ import annotations

import re
import time
import uuid
from typing import Any, Callable, Mapping, Optional
from urllib.parse import urlencode

import httpx

API_BASE = "https://api.stripe.com"
API_VERSION = "2024-06-20"
USER_AGENT = "obol-hermes-plugin/0.1"

_RETRY_STATUSES = frozenset({409, 429, 500, 502, 503, 504})
_KEY_RE = re.compile(r"\b(sk|rk|pk|whsec)_(test|live)?_?[A-Za-z0-9*]{4,}")


def redact(text: str) -> str:
    """Remove anything shaped like a Stripe key from text Obol shows or logs."""
    return _KEY_RE.sub("[redacted key]", text)


class StripeError(Exception):
    """A Stripe call failed. ``kind`` is a stable short code the tools surface to the model."""

    def __init__(self, message: str, *, kind: str = "api_error", status: Optional[int] = None,
                 code: Optional[str] = None, param: Optional[str] = None):
        super().__init__(message)
        self.kind, self.status, self.code, self.param = kind, status, code, param

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"error": str(self), "kind": self.kind}
        for key in ("status", "code", "param"):
            if getattr(self, key) is not None:
                out[key] = getattr(self, key)
        return out


def key_mode(key: Optional[str]) -> str:
    """``'test'`` / ``'live'`` / ``'missing'`` / ``'invalid'`` from a secret or restricted key."""
    if not key:
        return "missing"
    key = key.strip()
    if key.startswith(("sk_test_", "rk_test_")):
        return "test"
    if key.startswith(("sk_live_", "rk_live_")):
        return "live"
    return "invalid"


def encode_form(data: Mapping[str, Any], prefix: str = "") -> list[tuple[str, str]]:
    """Stripe's bracketed form encoding: ``{"metadata": {"a": 1}}`` -> ``metadata[a]=1``."""
    pairs: list[tuple[str, str]] = []
    for key, value in data.items():
        name = f"{prefix}[{key}]" if prefix else str(key)
        if value is None:
            continue
        if isinstance(value, Mapping):
            pairs.extend(encode_form(value, name))
        elif isinstance(value, (list, tuple)):
            for i, item in enumerate(value):
                if isinstance(item, Mapping):
                    pairs.extend(encode_form(item, f"{name}[{i}]"))
                else:
                    pairs.append((f"{name}[]", _scalar(item)))
        else:
            pairs.append((name, _scalar(value)))
    return pairs


def _scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


class StripeClient:
    def __init__(self, api_key: Optional[str], *, allow_live: bool = False, timeout: float = 20.0,
                 max_retries: int = 2, transport: Optional[httpx.BaseTransport] = None,
                 sleep: Callable[[float], None] = time.sleep, base_url: str = API_BASE):
        mode = key_mode(api_key)
        if mode == "missing":
            raise StripeError(
                "No Stripe key configured. Set STRIPE_API_KEY to a test key (sk_test_...) from "
                "https://dashboard.stripe.com/test/apikeys, e.g. `hermes config set` or the "
                "plugin's settings page, then retry.", kind="not_configured")
        if mode == "invalid":
            raise StripeError("STRIPE_API_KEY does not look like a Stripe secret or restricted key "
                              "(expected sk_test_/rk_test_/sk_live_/rk_live_).", kind="not_configured")
        if mode == "live" and not allow_live:
            raise StripeError(
                "This is a LIVE key and live mode is off, so nothing was sent. Obol only moves real money "
                "when plugins.entries.obol.settings.allow_live is true; use a test key for demos.",
                kind="live_blocked")
        self.mode = mode
        self._max_retries = max(0, int(max_retries))
        self._sleep = sleep
        self._http = httpx.Client(
            base_url=base_url, timeout=timeout, transport=transport,
            headers={"Authorization": f"Bearer {api_key.strip()}", "Stripe-Version": API_VERSION,
                     "User-Agent": USER_AGENT})

    # -- plumbing -----------------------------------------------------------------------------
    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "StripeClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def request(self, method: str, path: str, *, params: Optional[Mapping[str, Any]] = None,
                data: Optional[Mapping[str, Any]] = None, idempotency_key: Optional[str] = None) -> dict:
        headers = {}
        if method == "POST":
            headers["Idempotency-Key"] = idempotency_key or f"obol-{uuid.uuid4()}"
        query = encode_form(params) if params else None
        body = urlencode(encode_form(data)) if data else None
        if body is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        attempt = 0
        while True:
            try:
                resp = self._http.request(method, path, params=query, content=body, headers=headers)
            except httpx.TimeoutException:
                if attempt < self._max_retries:
                    attempt += 1
                    self._sleep(0.5 * 2 ** attempt)
                    continue
                raise StripeError(f"Stripe did not answer in time after {attempt + 1} attempts. The "
                                  "request may still have gone through: check obol_list_invoices "
                                  "before trying again.", kind="timeout") from None
            except httpx.HTTPError as exc:
                if attempt < self._max_retries:
                    attempt += 1
                    self._sleep(0.5 * 2 ** attempt)
                    continue
                raise StripeError(f"Could not reach Stripe: {exc.__class__.__name__}",
                                  kind="network") from None
            if resp.status_code in _RETRY_STATUSES and attempt < self._max_retries:
                attempt += 1
                retry_after = resp.headers.get("Retry-After")
                try:
                    delay = min(float(retry_after), 8.0) if retry_after else 0.5 * 2 ** attempt
                except ValueError:
                    delay = 0.5 * 2 ** attempt
                self._sleep(delay)
                continue
            return self._parse(resp)

    @staticmethod
    def _parse(resp: httpx.Response) -> dict:
        try:
            payload = resp.json()
        except ValueError:
            payload = None
        if 200 <= resp.status_code < 300 and isinstance(payload, dict):
            return payload
        err = (payload or {}).get("error") if isinstance(payload, dict) else None
        err = err if isinstance(err, dict) else {}
        message = err.get("message") or f"Stripe returned HTTP {resp.status_code}"
        kind = {401: "auth", 403: "permission", 404: "not_found", 429: "rate_limited"}.get(
            resp.status_code, "invalid_request" if resp.status_code == 400 else "api_error")
        if kind == "auth":
            message = "Stripe rejected the API key (401). Check STRIPE_API_KEY."
        raise StripeError(redact(str(message)), kind=kind, status=resp.status_code,
                          code=err.get("code"), param=err.get("param"))

    # -- endpoints ----------------------------------------------------------------------------
    def find_customer_by_email(self, email: str) -> Optional[dict]:
        found = self.request("GET", "/v1/customers", params={"email": email, "limit": 1})
        data = found.get("data") or []
        return data[0] if data else None

    def create_customer(self, *, email: str, name: Optional[str], idempotency_key: str) -> dict:
        return self.request("POST", "/v1/customers", idempotency_key=idempotency_key,
                            data={"email": email, "name": name, "metadata": {"created_by": "obol"}})

    def create_invoice(self, *, customer: str, currency: str, days_until_due: int,
                       description: Optional[str], metadata: Mapping[str, str], idempotency_key: str) -> dict:
        return self.request("POST", "/v1/invoices", idempotency_key=idempotency_key, data={
            "customer": customer, "currency": currency, "collection_method": "send_invoice",
            "days_until_due": days_until_due, "description": description, "auto_advance": False,
            "pending_invoice_items_behavior": "exclude", "metadata": dict(metadata)})

    def add_invoice_item(self, *, customer: str, invoice: str, currency: str, description: str,
                         unit_amount: int, quantity: int, idempotency_key: str) -> dict:
        return self.request("POST", "/v1/invoiceitems", idempotency_key=idempotency_key, data={
            "customer": customer, "invoice": invoice, "currency": currency, "description": description,
            "unit_amount": unit_amount, "quantity": quantity})

    def finalize_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict:
        return self.request("POST", f"/v1/invoices/{invoice_id}/finalize",
                            idempotency_key=idempotency_key, data={"auto_advance": False})

    def send_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict:
        return self.request("POST", f"/v1/invoices/{invoice_id}/send", idempotency_key=idempotency_key)

    def void_invoice(self, invoice_id: str, *, idempotency_key: str) -> dict:
        return self.request("POST", f"/v1/invoices/{invoice_id}/void", idempotency_key=idempotency_key)

    def delete_draft(self, invoice_id: str) -> dict:
        return self.request("DELETE", f"/v1/invoices/{invoice_id}")

    def get_invoice(self, invoice_id: str) -> dict:
        return self.request("GET", f"/v1/invoices/{invoice_id}")

    def list_invoices(self, *, limit: int = 100, status: Optional[str] = None,
                      customer: Optional[str] = None, starting_after: Optional[str] = None) -> dict:
        return self.request("GET", "/v1/invoices", params={
            "limit": limit, "status": status, "customer": customer, "starting_after": starting_after})

    def get_charge(self, charge_id: str) -> dict:
        return self.request("GET", f"/v1/charges/{charge_id}")

    def list_disputes(self, charge_id: str) -> list[dict]:
        return self.request("GET", "/v1/disputes", params={"charge": charge_id, "limit": 10}).get("data") or []

    def list_test_clocks(self, limit: int = 100) -> list[dict]:
        """Test mode only: Stripe test clocks (simulated time)."""
        return self.request("GET", "/v1/test_helpers/test_clocks", params={"limit": limit}).get("data") or []

    def list_clock_customers(self, clock_id: str, limit: int = 100) -> list[dict]:
        # Stripe hides test-clock customers from the normal list unless the clock is named.
        return self.request("GET", "/v1/customers", params={"test_clock": clock_id, "limit": limit}).get("data") or []

    def list_events(self, *, types: list[str], created_gte: int, limit: int = 100) -> dict:
        """Account events (Stripe keeps 30 days). Used by the contact-change risk check."""
        return self.request("GET", "/v1/events", params={
            "types": list(types), "created": {"gte": int(created_gte)}, "limit": limit})
