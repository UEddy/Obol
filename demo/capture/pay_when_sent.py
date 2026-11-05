"""Wait until Hermes has sent the demo client's invoice, then pay it on Stripe's hosted page (pay_capture.js).

    python demo/capture/pay_when_sent.py billing@acmestudio.example.com demo/capture/out

Run it in the background just before tapes/send_and_paid.tape: it polls Stripe (test mode) for an open invoice
to that address created after it started, and records the payment while the tape waits.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from obol_lib.stripe_client import StripeClient  # noqa: E402

email, out = sys.argv[1], sys.argv[2]
key = os.environ.get("STRIPE_API_KEY") or os.environ["STRIPE_SECRET_KEY"]
if not key.startswith(("sk_test_", "rk_test_")):
    sys.exit("refusing: not a Stripe test key")
client, started = StripeClient(key), int(time.time())
deadline = time.time() + 900
while time.time() < deadline:
    cus = client.find_customer_by_email(email)
    if cus:
        open_ = [i for i in client.request("GET", "/v1/invoices", params={"customer": cus["id"], "status": "open", "limit": 5})["data"]
                 if i["created"] >= started - 5 and i.get("hosted_invoice_url")]
        if open_:
            time.sleep(4)   # let the CLI show the link first
            subprocess.run(["node", str(Path(__file__).with_name("pay_capture.js")), open_[0]["hosted_invoice_url"], out], check=True)
            sys.exit(0)
    time.sleep(3)
sys.exit("timed out waiting for the invoice")
