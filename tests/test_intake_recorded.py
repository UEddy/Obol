"""Replay real model extractions (recorded by test_intake_live.py) through intake. No key needed."""

import json

import pytest

from intake_cases import CASES, RECORDED, check, run

pytestmark = pytest.mark.skipif(not RECORDED.exists(), reason="no recorded model outputs yet")


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["id"])
def test_recorded_model_output_meets_expectations(case):
    recorded = json.loads(RECORDED.read_text())
    parsed = recorded["outputs"][case["id"]]
    out = run(case, lambda instructions, text: parsed)
    assert check(case, out) == []
