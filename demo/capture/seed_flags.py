"""Seed one test-mode customer whose history makes a new $5,000 invoice raise three flags at once.

    STRIPE_API_KEY=sk_test_... python demo/capture/seed_flags.py

Kite & Co (billing@kiteco.example.com): three $500 invoices marked paid, one $5,000 invoice sent and open,
then the customer's address is changed. Asking Hermes for another $5,000 invoice then shows the duplicate,
unusual-amount (5,000 is over 3x the $1,625 average) and changed-contact-details flags. Test keys only.
"""

import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from obol_lib.stripe_client import StripeClient  # noqa: E402

key = os.environ.get("STRIPE_API_KEY") or os.environ["STRIPE_SECRET_KEY"]
if not key.startswith(("sk_test_", "rk_test_")):
    sys.exit("refusing: not a Stripe test key")
c = StripeClient(key)
EMAIL = "billing@kiteco.example.com"
idem = lambda: uuid.uuid4().hex   # noqa: E731

cus = c.find_customer_by_email(EMAIL) or c.create_customer(email=EMAIL, name="Kite & Co", idempotency_key=idem())


def invoice(amount: int, desc: str, paid: bool) -> dict:
    inv = c.create_invoice(customer=cus["id"], currency="usd", days_until_due=14, description=None,
                           metadata={"created_by": "obol-demo-seed"}, idempotency_key=idem())
    c.add_invoice_item(customer=cus["id"], invoice=inv["id"], currency="usd", description=desc,
                       unit_amount=amount, quantity=1, idempotency_key=idem())
    inv = c.finalize_invoice(inv["id"], idempotency_key=idem())
    if paid:
        inv = c.request("POST", f"/v1/invoices/{inv['id']}/pay", data={"paid_out_of_band": "true"}, idempotency_key=idem())
    return inv


existing = c.request("GET", "/v1/invoices", params={"customer": cus["id"], "limit": 20})["data"]
if not existing:
    for m in ("June", "July", "August"):
        invoice(50000, f"Monthly agent maintenance ({m})", paid=True)
    invoice(500000, "Agent platform build", paid=False)
c.request("POST", f"/v1/customers/{cus['id']}", data={"address[line1]": "1 New Street", "address[city]": "Lagos",
                                                         "address[country]": "NG"}, idempotency_key=idem())
print("seeded", cus["id"], len(existing) or 4, "invoices; address changed")
