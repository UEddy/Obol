"""Record Obol's service flow against Stripe TEST mode into tests/fixtures/stripe/flow.json.

    STRIPE_API_KEY=sk_test_... python scripts/record_stripe_fixtures.py   (STRIPE_SECRET_KEY also works)

Creates one customer and two USD invoices in your Stripe test account (one sent, one voided).
Refuses anything but a test key. Responses are scrubbed of account names and invoice links
before they are written.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "src"), str(ROOT / "tests")]

from obol_lib.service import Settings  # noqa: E402
from obol_lib.store import Store  # noqa: E402
from obol_lib.stripe_client import StripeClient, key_mode  # noqa: E402
from recording import RecordingTransport, run_flow, save  # noqa: E402


def main() -> int:
    key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")
    if key_mode(key) != "test":
        print("Refusing: STRIPE_API_KEY must be a Stripe TEST key (sk_test_/rk_test_).", file=sys.stderr)
        return 2
    rec = RecordingTransport()
    steps: list[str] = []
    with StripeClient(key, transport=rec) as client:
        run_flow(client, Store.memory(), Settings(), "obol-fixture@example.com",
                 lambda step, _result: steps.append(step))
    save(rec.exchanges)
    print(f"Recorded {len(rec.exchanges)} exchanges over steps: {', '.join(steps)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
