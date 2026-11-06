"""Send three forwarded messages with injected instructions (hidden, encoded, translated) through Obol's real
obol_draft_from_message tool, dispatched by Hermes with the demo home's model doing the extraction.

    OBOL_DEMO_HOME=/path/to/demo-home python demo/capture/intake_variants.py

The messages live in tests/fixtures/demo_injection_messages.json (attack examples stay under tests/). Each
finding lands in Obol's security log, which the dashboard's Security view shows; that is what the demo films.
Model calls go through the plugin's own ctx.llm wrapper, exactly as in a chat.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.environ["HERMES_HOME"] = os.environ["OBOL_DEMO_HOME"]
from hermes_cli.plugins import discover_plugins  # noqa: E402
from model_tools import handle_function_call  # noqa: E402

discover_plugins(force=True)
for kind, message in json.loads((ROOT / "tests/fixtures/demo_injection_messages.json").read_text()).items():
    out = json.loads(handle_function_call("obol_draft_from_message", {"message": message, "source": "email"},
                                          session_id=f"demo-{kind}", task_id="demo"))
    print(kind, [(f["severity"], f.get("technique")) for f in out.get("security", [])], (out.get("proposal") or {}).get("total"))
