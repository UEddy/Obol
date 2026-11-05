"""Shared runner for the real-model intake cases (tests/fixtures/intake_cases.json)."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from obol_lib import intake, service
from obol_lib.service import Settings
from obol_lib.store import Store

FIXTURES = Path(__file__).resolve().parent / "fixtures"
CASES = json.loads((FIXTURES / "intake_cases.json").read_text())
RECORDED = FIXTURES / "intake_recorded.json"


def store_for(case: dict) -> Store:
    st = Store.memory()
    known = case.get("known_client")
    if known:  # the client as Obol already knows it (a past invoice in the cache)
        st.upsert([{"id": "in_known0001", "customer": "cus_known", "customer_name": known["name"],
                    "customer_email": known["email"], "currency": "usd", "amount_due": 90000, "amount_paid": 90000,
                    "amount_remaining": 0, "status": "paid", "created": 1_760_000_000}])
    return st


def run(case: dict, extract) -> dict:
    today = dt.date.fromisoformat(CASES["today"])
    return intake.draft_from_message(extract, store_for(case), Settings(),
                                     {"message": case["message"], "source": case["source"]}, today=today)


def check(case: dict, out: dict) -> list[str]:
    """Problems with an intake result against the case's expectations ([] = pass)."""
    e, p, problems = case["expect"], out.get("proposal") or {}, []
    if "email" in e and p.get("customer_email") != e["email"]:
        problems.append(f"email {p.get('customer_email')!r} != {e['email']!r}")
    if "email_one_of" in e and p.get("customer_email") not in e["email_one_of"]:
        problems.append(f"email {p.get('customer_email')!r} not in {e['email_one_of']}")
    if "total" in e and out.get("total") != e["total"]:
        problems.append(f"total {out.get('total')!r} != {e['total']!r}")
    if "days_until_due" in e and p.get("days_until_due") != e["days_until_due"]:
        problems.append(f"days_until_due {p.get('days_until_due')} != {e['days_until_due']}")
    if "missing" in e and out.get("missing") != e["missing"]:
        problems.append(f"missing {out.get('missing')} != {e['missing']}")
    if "missing_contains" in e and out.get("proposal") is not None and e["missing_contains"] not in (out.get("missing") or []):
        problems.append(f"missing {out.get('missing')} lacks {e['missing_contains']}")
    checks = {f["check"] for f in out.get("security") or [] if f.get("severity") == "high"}
    if e.get("security") == [] and checks:
        problems.append(f"unexpected security findings {checks}")
    for c in e.get("security_contains", []):
        if c not in checks:
            problems.append(f"security findings {checks} lack {c}")
    if p and p.get("send") is not False:
        problems.append("proposal must never be sent automatically")
    if out.get("created_in_stripe") not in (False, None):
        problems.append("intake must not create anything in Stripe")
    return problems
