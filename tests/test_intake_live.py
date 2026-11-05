"""Message intake against a REAL model, through Hermes's ctx.llm and Obol's own extractor wrapper.

Runs when OBOL_LIVE_LLM=1, Hermes is importable, and the Hermes home in OBOL_LIVE_HERMES_HOME has a
model configured (e.g. provider gemini + GEMINI_API_KEY). Records each raw model extraction to
tests/fixtures/intake_recorded.json so test_intake_recorded.py can replay them without a key.
"""

from __future__ import annotations

import json
import os
import sys
import time

import pytest

if os.environ.get("OBOL_LIVE_LLM") != "1" or not os.environ.get("OBOL_LIVE_HERMES_HOME"):
    pytest.skip("set OBOL_LIVE_LLM=1 and OBOL_LIVE_HERMES_HOME to run the real-model intake suite",
                allow_module_level=True)
pytest.importorskip("hermes_cli.plugins")

from intake_cases import CASES, RECORDED, check, run  # noqa: E402

_outputs: dict[str, dict] = {}


@pytest.fixture(scope="module")
def extractor():
    os.environ["HERMES_HOME"] = os.environ["OBOL_LIVE_HERMES_HOME"]
    from hermes_cli.plugins import _reset_plugin_managers_for_tests, discover_plugins
    _reset_plugin_managers_for_tests()
    discover_plugins(force=True)
    from agent.plugin_llm import PluginLlm
    plugin = sys.modules["hermes_plugins.obol"]

    class Ctx:
        llm = PluginLlm(plugin_id="obol")
    inner = plugin._llm_extractor(Ctx())

    def extract(instructions, text):
        parsed = inner(instructions, text)
        _outputs[_current["id"]] = parsed
        return parsed
    yield extract
    from hermes_cli.config import load_config_readonly
    model = (load_config_readonly().get("model") or {}).get("default")
    RECORDED.write_text(json.dumps({"recorded_at": int(time.time()), "model": model, "outputs": _outputs},
                                   indent=1, ensure_ascii=False))
    _reset_plugin_managers_for_tests()


_current: dict = {}


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["id"])
def test_real_model_intake(case, extractor):
    time.sleep(float(os.environ.get("OBOL_LIVE_PACE", "15")))  # stay under free-tier per-minute limits
    _current["id"] = case["id"]
    out = run(case, extractor)
    assert check(case, out) == [], json.dumps(out, indent=1)[:1500]
