"""Clear the demo client's unpaid invoices before a retake (Stripe TEST mode only).

    STRIPE_API_KEY=sk_test_... python demo/capture/reset_demo_client.py

Deletes drafts and voids open invoices for the demo client and its lookalike, so a retake starts
clean (Obol's duplicate check ignores void invoices). Paid invoices can't be voided; if one exists
the script says so, because a retake would then (correctly) be flagged as a duplicate.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from obol_lib.stripe_client import StripeClient, key_mode  # noqa: E402

EMAILS = {"billing@pinemoor.example.com", "billing@pinernoor.example.com", "billing@acmestudio.example.com", "billing@acrnestudio.example.com"}

key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")
if key_mode(key) != "test":
    sys.exit("Refusing: needs a Stripe TEST key.")
c = StripeClient(key)
for inv in c.list_invoices(limit=100).get("data") or []:
    if (inv.get("customer_email") or "").lower() not in EMAILS:
        continue
    if inv["status"] == "draft":
        c.delete_draft(inv["id"]); print("deleted draft", inv["id"])
    elif inv["status"] == "open":
        c.void_invoice(inv["id"], idempotency_key=f"obol-reset-{inv['id']}"); print("voided", inv["id"])
    elif inv["status"] == "paid":
        print("PAID invoice exists:", inv["id"], "- a retake of the payoff will be flagged as a duplicate")
