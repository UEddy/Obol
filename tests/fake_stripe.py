"""In-memory stand-in for the slice of the Stripe API Obol uses (tests only).

Honours Idempotency-Key the way Stripe does (same key -> same stored response, no second
side effect), and can inject failures to exercise retry and cleanup paths.
"""

from __future__ import annotations

import itertools
import json
import time
from urllib.parse import parse_qsl

import httpx


class FakeStripe:
    def __init__(self, now: int | None = None):
        self.now = now or int(time.time())
        self.customers: dict[str, dict] = {}
        self.invoices: dict[str, dict] = {}
        self.items: dict[str, list[dict]] = {}
        self.sent: list[str] = []
        self.events: list[dict] = []
        self.clocks: dict[str, dict] = {}
        self.charges: dict[str, dict] = {}
        self.disputes: list[dict] = []
        self.calls: list[tuple[str, str]] = []
        self.idem: dict[str, httpx.Response] = {}
        self.fail_queue: list[tuple[str, int]] = []   # (path substring, status) consumed in order
        self.timeout_queue: list[str] = []
        self._ids = itertools.count(1)
        self.transport = httpx.MockTransport(self._handle)

    # -- helpers --------------------------------------------------------------------------------
    def _id(self, prefix: str) -> str:
        return f"{prefix}_{next(self._ids):08d}TEST"

    def dispute(self, inv_id: str, reason: str = "fraudulent") -> None:
        ch = self.invoices[inv_id]["charge"]
        self.charges[ch]["disputed"] = True
        self.disputes.append({"id": self._id("dp"), "charge": ch, "reason": reason, "status": "needs_response"})

    def customer_updated(self, customer_id: str, previous: dict, at: int | None = None) -> None:
        """Record a customer.updated event, as Stripe does when email or payment details change."""
        self.events.append({"id": self._id("evt"), "object": "event", "type": "customer.updated",
                            "created": at or self.now, "data": {"object": self.customers[customer_id],
                                                                "previous_attributes": previous}})

    def pay(self, inv_id: str, risk_level: str = "normal", risk_score: int = 12) -> None:
        inv = self.invoices[inv_id]
        ch = self._id("ch")
        self.charges[ch] = {"id": ch, "object": "charge", "disputed": False,
                            "outcome": {"risk_level": risk_level, "risk_score": risk_score, "type": "authorized"}}
        inv["charge"] = ch
        inv.update(status="paid", amount_paid=inv["amount_due"], amount_remaining=0)
        inv["status_transitions"]["paid_at"] = self.now

    @staticmethod
    def _json(status: int, body: dict) -> httpx.Response:
        return httpx.Response(status, json=body)

    def _err(self, status: int, message: str, code: str | None = None) -> httpx.Response:
        return self._json(status, {"error": {"type": "invalid_request_error", "message": message, "code": code}})

    def _recalc(self, inv: dict) -> None:
        total = sum(i["unit_amount"] * i["quantity"] for i in self.items.get(inv["id"], []))
        inv["amount_due"] = total
        inv["amount_remaining"] = total - inv["amount_paid"]

    # -- router ---------------------------------------------------------------------------------
    def _handle(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append((method, path))
        for i, needle in enumerate(self.timeout_queue):
            if needle in path:
                self.timeout_queue.pop(i)
                raise httpx.ReadTimeout("simulated", request=request)
        for i, (needle, status) in enumerate(self.fail_queue):
            if needle in path:
                self.fail_queue.pop(i)
                return self._err(status, f"simulated {status}")
        if not request.headers.get("Authorization", "").startswith("Bearer sk_test_"):
            return self._json(401, {"error": {"message": "Invalid API Key provided"}})
        key = request.headers.get("Idempotency-Key")
        if method == "POST":
            assert key, "every POST must carry an Idempotency-Key"
            if key in self.idem:
                return self.idem[key]
        form = dict(parse_qsl(request.content.decode())) if request.content else {}
        query = request.url.params
        resp = self._route(method, path, form, query)
        if method == "POST" and resp.status_code < 500:
            self.idem[key] = resp
        return resp

    def _route(self, method: str, path: str, form: dict, query: dict) -> httpx.Response:
        parts = path.strip("/").split("/")[1:]  # drop "v1"
        if parts == ["test_helpers", "test_clocks"] and method == "GET":
            return self._json(200, {"object": "list", "data": list(self.clocks.values()), "has_more": False})
        if parts == ["test_helpers", "test_clocks"] and method == "POST":
            cid = self._id("clock")
            self.clocks[cid] = {"id": cid, "name": form.get("name"), "frozen_time": int(form.get("frozen_time", self.now))}
            return self._json(200, self.clocks[cid])
        if parts == ["customers"] and method == "GET" and query.get("test_clock"):
            data = [c for c in self.customers.values() if c.get("test_clock") == query.get("test_clock")]
            return self._json(200, {"object": "list", "data": data, "has_more": False})
        if parts == ["customers"] and method == "GET":
            # Like Stripe: customers on a test clock are hidden unless the clock is named.
            data = [c for c in self.customers.values() if c["email"] == query.get("email") and not c.get("test_clock")]
            return self._json(200, {"object": "list", "data": data[: int(query.get("limit", 10))], "has_more": False})
        if parts == ["customers"] and method == "POST":
            cid = self._id("cus")
            self.customers[cid] = {"id": cid, "email": form.get("email"), "name": form.get("name"),
                                   "test_clock": form.get("test_clock")}
            return self._json(200, self.customers[cid])
        if parts == ["invoices"] and method == "POST":
            cus = self.customers.get(form.get("customer", ""))
            if cus is None:
                return self._err(400, "No such customer", "resource_missing")
            iid = self._id("in")
            days = int(form.get("days_until_due", 30))
            self.invoices[iid] = {
                "id": iid, "object": "invoice", "number": None, "customer": cus["id"],
                "customer_email": cus["email"], "customer_name": cus["name"], "currency": form["currency"],
                "description": form.get("description"), "status": "draft", "amount_due": 0,
                "amount_paid": 0, "amount_remaining": 0, "created": self.now + len(self.invoices),
                "due_date": None, "_days": days, "hosted_invoice_url": None, "invoice_pdf": None,
                "livemode": False, "status_transitions": {"paid_at": None},
            }
            return self._json(200, self.invoices[iid])
        if parts == ["invoices"] and method == "GET":
            data = sorted(self.invoices.values(), key=lambda i: -i["created"])
            if not query.get("customer"):
                clocked = {cid for cid, c in self.customers.items() if c.get("test_clock")}
                data = [i for i in data if i["customer"] not in clocked]
            if query.get("customer"):
                data = [i for i in data if i["customer"] == query["customer"]]
            if query.get("status"):
                data = [i for i in data if i["status"] == query["status"]]
            if query.get("starting_after"):
                ids = [i["id"] for i in data]
                data = data[ids.index(query["starting_after"]) + 1:]
            limit = int(query.get("limit", 10))
            return self._json(200, {"object": "list", "data": data[:limit], "has_more": len(data) > limit})
        if parts[:1] == ["charges"] and len(parts) == 2 and method == "GET":
            ch = self.charges.get(parts[1])
            return self._json(200, ch) if ch else self._err(404, "No such charge", "resource_missing")
        if parts == ["disputes"] and method == "GET":
            return self._json(200, {"object": "list", "data": [d for d in self.disputes if d["charge"] == query.get("charge")],
                                    "has_more": False})
        if parts == ["events"] and method == "GET":
            types = set(query.get_list("types[]")) if hasattr(query, "get_list") else set()
            gte = int(query.get("created[gte]", 0))
            data = [e for e in reversed(self.events) if e["created"] >= gte and (not types or e["type"] in types)]
            return self._json(200, {"object": "list", "data": data[: int(query.get("limit", 10))], "has_more": False})
        if parts == ["invoiceitems"] and method == "POST":
            inv = self.invoices.get(form.get("invoice", ""))
            if inv is None or inv["status"] != "draft":
                return self._err(400, "invoice not editable")
            item = {"description": form["description"], "unit_amount": int(form["unit_amount"]),
                    "quantity": int(form.get("quantity", 1))}
            self.items.setdefault(inv["id"], []).append(item)
            self._recalc(inv)
            return self._json(200, {"id": self._id("ii"), **item})
        if len(parts) >= 2 and parts[0] == "invoices":
            inv = self.invoices.get(parts[1])
            if inv is None:
                return self._err(404, f"No such invoice: '{parts[1]}'", "resource_missing")
            action = parts[2] if len(parts) > 2 else None
            if method == "GET" and action is None:
                return self._json(200, inv)
            if method == "DELETE" and action is None:
                if inv["status"] != "draft":
                    return self._err(400, "only drafts can be deleted")
                del self.invoices[inv["id"]]
                return self._json(200, {"id": inv["id"], "deleted": True})
            if action == "finalize":
                if inv["status"] != "draft":
                    return self._err(400, "invoice is not a draft")
                inv.update(status="open", number=f"OBOL-{len(self.sent) + 1:04d}",
                           due_date=self.now + inv["_days"] * 86400,
                           hosted_invoice_url=f"https://invoice.stripe.com/i/test_{inv['id']}",
                           invoice_pdf=f"https://pay.stripe.com/invoice/test_{inv['id']}/pdf")
                return self._json(200, inv)
            if action == "send":
                if inv["status"] != "open":
                    return self._err(400, "invoice is not open")
                self.sent.append(inv["id"])
                return self._json(200, inv)
            if action == "void":
                if inv["status"] != "open":
                    return self._err(400, "invoice is not open")
                inv["status"] = "void"
                return self._json(200, inv)
        return self._err(404, f"unhandled {method} {path}")


def dumps(obj) -> str:
    return json.dumps(obj, indent=2, default=str)
