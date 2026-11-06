"""The bank-transfer invoice for the demo video, issued by Obol's real bank-transfer client (no network).

    python demo/capture/bank_pdf.py demo/remotion/public/captures/paper

Issues the same invoice the Telegram scene sends (Acme Studio: build and revisions, $2,350, due in 14 days) in
bank-transfer mode, then renders the PDF Obol writes to bank-invoice.png (pdftoppm, 200 dpi). Sample payout details only.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from obol_lib import service  # noqa: E402
from obol_lib.bank_client import BankClient  # noqa: E402
from obol_lib.service import Settings  # noqa: E402
from obol_lib.store import Store  # noqa: E402

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
st = Settings(provider="bank_transfer", business_name="Sam Rivera Studio", bank_account_name="Sam Rivera",
              bank_name="Example Bank", bank_account_number="0123 4567 89", bank_routing="GB33 EXMP 1234 5678 9012 34")
with tempfile.TemporaryDirectory() as tmp:
    store = Store.memory()
    res = service.create_invoice(BankClient(store, st, Path(tmp)), store, st, {
        "customer_email": "billing@acmestudio.example.com", "customer_name": "Acme Studio", "send": True,
        "days_until_due": 14,
        "line_items": [{"description": "Build", "amount": 2000}, {"description": "Revisions", "amount": 350}]})
    pdf = Path(res["invoice_pdf"])
    (out / "bank-invoice.pdf").write_bytes(pdf.read_bytes())
    subprocess.run(["pdftoppm", "-png", "-r", "200", "-singlefile", str(pdf), str(out / "bank-invoice")], check=True)
    print(res["invoice"]["number"], res["invoice"]["amount_due"], "->", out / "bank-invoice.png")
