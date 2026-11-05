"""Seed a believable Stripe TEST-mode history for the demo: a freelance designer's receivables.

    STRIPE_API_KEY=sk_test_... python demo/seed_stripe.py          (STRIPE_SECRET_KEY also works)

Everything is created through Obol's own service layer (the same code the Hermes tools use),
on Stripe *test clocks*, so that:
* paid and overdue invoices have real past dates (a clock frozen 40 days ago issues an invoice
  then, so it is genuinely past due now), and
* re-running the script deletes the previous seed cleanly: deleting a test clock deletes its
  customers and invoices.

Refuses anything but a test key. All customers use @example.com addresses. USD only.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from obol_lib import service  # noqa: E402
from obol_lib.service import Settings  # noqa: E402
from obol_lib.store import Store  # noqa: E402
from obol_lib.stripe_client import StripeClient, key_mode  # noqa: E402

CLOCK_PREFIX = "obol-demo"
LEFTOVERS = {"obol-fixture@example.com"}
DAY = 86400

# (client, email, days ago issued, net days, line items, paid?)
BOOK = [
    ("Northwind Studio", "accounts@northwind.example.com", 62, 14,
     [("Brand identity: logo, palette, type system", 2400, 1)], True),
    ("Bluebird Coffee", "hello@bluebird.example.com", 55, 14,
     [("Menu board redesign", 650, 1), ("Print-ready files", 200, 1)], True),
    ("Lumen Health", "finance@lumenhealth.example.com", 34, 14,
     [("Marketing site design, 6 pages", 450, 6)], True),
    ("Fernhill Books", "ap@fernhill.example.com", 40, 14,
     [("Book cover series, 3 titles", 450, 3), ("Spine and back-cover layouts", 100, 1)], False),   # overdue
    ("Kestrel Fitness", "billing@kestrel.example.com", 24, 14,
     [("App icon set", 900, 1)], False),                                                             # overdue
    ("Harbor & Pine", "studio@harborpine.example.com", 4, 14,
     [("Packaging design, 2 SKUs", 900, 2)], False),                                                 # outstanding
    ("Olive Street Bakery", "orders@olivestreet.example.com", 2, 14,
     [("Social media templates", 65, 10)], False),                                                   # outstanding
]


def key() -> str:
    k = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")
    if key_mode(k) != "test":
        sys.exit("Refusing: set a Stripe TEST key (sk_test_/rk_test_) in STRIPE_API_KEY or STRIPE_SECRET_KEY.")
    return k


def delete_previous(c: StripeClient) -> int:
    clocks = c.request("GET", "/v1/test_helpers/test_clocks", params={"limit": 100}).get("data") or []
    n = 0
    for clock in clocks:
        if str(clock.get("name", "")).startswith(CLOCK_PREFIX):
            c.request("DELETE", f"/v1/test_helpers/test_clocks/{clock['id']}")
            n += 1
    return n


def new_clock(c: StripeClient, days_ago: int, label: str) -> str:
    clock = c.request("POST", "/v1/test_helpers/test_clocks", idempotency_key=None,
                      data={"frozen_time": int(time.time()) - days_ago * DAY, "name": f"{CLOCK_PREFIX} {label}"})
    return clock["id"]


def customer(c: StripeClient, name: str, email: str, clock: str) -> dict:
    return c.request("POST", "/v1/customers", data={"name": name, "email": email, "test_clock": clock,
                                                    "metadata": {"obol_demo": "1"}})


def pay_with_test_card(c: StripeClient, cus_id: str, inv_id: str) -> None:
    pm = c.request("POST", "/v1/payment_methods/pm_card_visa/attach", data={"customer": cus_id})
    c.request("POST", f"/v1/invoices/{inv_id}/pay", data={"payment_method": pm["id"]})


def invoice(c: StripeClient, store: Store, cus_id: str, net: int, items: list, tag: str) -> str:
    """Build, finalize and send one invoice on a given customer with Obol's Stripe client.

    (service.create_invoice looks customers up by email, and Stripe's customer list hides
    test-clock customers, so the seed passes the customer id explicitly.)"""
    inv = c.create_invoice(customer=cus_id, currency="usd", days_until_due=net, description=items[0][0],
                           metadata={"created_by": "obol", "obol_demo": "1"}, idempotency_key=f"obol-seed-{tag}-inv")
    for n, (desc, amount, qty) in enumerate(items):
        c.add_invoice_item(customer=cus_id, invoice=inv["id"], currency="usd", description=desc,
                           unit_amount=int(amount * 100), quantity=qty, idempotency_key=f"obol-seed-{tag}-item{n}")
    c.finalize_invoice(inv["id"], idempotency_key=f"obol-seed-{tag}-fin")
    c.send_invoice(inv["id"], idempotency_key=f"obol-seed-{tag}-send")
    return inv["id"]


def main() -> int:
    with StripeClient(key()) as c:
        print(f"deleted {delete_previous(c)} previous demo clock(s)")
        for inv in c.list_invoices(limit=100, status="open").get("data") or []:
            if inv.get("customer_email") in LEFTOVERS:   # fixture-recorder / live-test invoices
                c.void_invoice(inv["id"], idempotency_key=f"obol-seed-void-{inv['id']}")
                print(f"voided leftover {inv['id']} ({inv['customer_email']})")
        store, settings = Store.memory(), Settings()
        for name, email, days_ago, net, items, paid in BOOK:
            clock = new_clock(c, days_ago, name)
            cus = customer(c, name, email, clock)
            tag = f"{cus['id']}"
            inv_id = invoice(c, store, cus["id"], net, items, tag)
            if paid:
                pay_with_test_card(c, cus["id"], inv_id)
            inv = service.get_invoice(c, store, {"invoice_id": inv_id})["invoice"]
            print(f"  {inv['number']:<16} {name:<22} {inv['amount_due']:>10}  {inv['status']:<8} due {inv['due_date']}")
        print(service.ledger_text(store, livemode=False, limit=0).splitlines()[1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
