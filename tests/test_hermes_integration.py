"""Load Obol through Hermes's real plugin manager and drive it via handle_function_call.

Skipped when Hermes is not importable (plain `pytest` on a machine without hermes-agent).
Run inside the Hermes venv to exercise discovery, registration, the pre_tool_call hook,
the slash command and the tool registry end to end (Stripe is the in-memory fake).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

pytest.importorskip("hermes_cli.plugins")

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def hermes(tmp_path_factory):
    home = tmp_path_factory.mktemp("hermes_home")
    (home / "plugins").mkdir()
    (home / "plugins" / "obol").symlink_to(ROOT, target_is_directory=True)
    (home / "config.yaml").write_text(
        "plugins:\n  enabled: [obol]\n  isolation: in_process\n"
        "  entries:\n    obol:\n      settings:\n        approval: always\n")
    old = {k: os.environ.get(k) for k in ("HERMES_HOME", "STRIPE_API_KEY")}
    os.environ["HERMES_HOME"] = str(home)
    os.environ["STRIPE_API_KEY"] = "sk_test_integration"
    from hermes_cli.plugins import discover_plugins, get_plugin_manager
    discover_plugins(force=True)
    runtime = next(m for name, m in sys.modules.items()
                   if name.startswith("hermes_plugins.") and name.endswith(".src.obol_lib.runtime"))
    yield get_plugin_manager(), runtime
    for k, v in old.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


@pytest.fixture
def fake(hermes):
    from fake_stripe import FakeStripe
    from obol_lib.stripe_client import StripeClient
    _, runtime = hermes
    fs = FakeStripe()
    original = runtime.client_factory
    runtime.client_factory = lambda key, **kw: runtime.StripeClient(key, transport=fs.transport,
                                                                     sleep=lambda _s: None, **kw)
    assert StripeClient  # the test-side import path also works
    yield fs
    runtime.client_factory = original


def call(name, args):
    from model_tools import handle_function_call
    return json.loads(handle_function_call(name, args, skip_pre_tool_call_hook=True))


def test_tools_registered(hermes):
    from tools.registry import registry
    for name in ("obol_create_invoice", "obol_send_invoice", "obol_get_invoice",
                 "obol_list_invoices", "obol_send_reminder", "obol_void_invoice"):
        assert registry.get_entry(name) is not None, name


def test_full_flow_through_registry(hermes, fake):
    out = call("obol_create_invoice", {"customer_email": "ap@globex.test", "customer_name": "Globex",
                                       "line_items": [{"description": "Retainer", "amount": 2500}], "send": True})
    inv_id = out["invoice"]["invoice_id"]
    assert out["sent"] and out["payment_link"]
    fake.pay(inv_id)
    got = call("obol_get_invoice", {"invoice_id": inv_id})
    assert got["invoice"]["status"] == "paid"
    listed = call("obol_list_invoices", {"status": "paid"})
    assert listed["totals"]["usd"]["paid"] == "$2,500.00"


def test_errors_are_json_not_exceptions(hermes, fake):
    out = call("obol_create_invoice", {"customer_email": "nope", "line_items": []})
    assert out["kind"] == "invalid_arguments"
    out = call("obol_get_invoice", {"invoice_id": "in_doesnotexist"})
    assert out["kind"] == "not_found"


def test_missing_key_message(hermes, fake):
    os.environ.pop("STRIPE_API_KEY")
    try:
        out = call("obol_list_invoices", {})
        assert out["kind"] == "not_configured" and "STRIPE_API_KEY" in out["error"]
    finally:
        os.environ["STRIPE_API_KEY"] = "sk_test_integration"


def test_approval_gate_directives(hermes, fake):
    from hermes_cli.plugins import invoke_hook
    results = invoke_hook("pre_tool_call", tool_name="obol_create_invoice", task_id="t",
                          args={"customer_email": "a@b.test", "send": True,
                                "line_items": [{"description": "x", "amount": 1200}]})
    directive = next(r for r in results if isinstance(r, dict))
    assert directive["action"] == "approve" and "$1,200.00" in directive["message"]
    assert "test mode" in directive["message"]
    drafts = invoke_hook("pre_tool_call", tool_name="obol_create_invoice", task_id="t",
                         args={"customer_email": "a@b.test", "line_items": []})
    assert not any(isinstance(r, dict) for r in drafts)
    reads = invoke_hook("pre_tool_call", tool_name="obol_get_invoice", task_id="t", args={})
    assert not any(isinstance(r, dict) for r in reads)


def test_slash_command(hermes, fake):
    manager, _ = hermes
    from hermes_cli.plugins import get_plugin_command_handler
    handler = get_plugin_command_handler("invoices")
    call("obol_create_invoice", {"customer_email": "x@initech.test", "customer_name": "Initech",
                                 "line_items": [{"description": "TPS audit", "amount": 300}], "send": True})
    text = handler("sync")
    assert "OBOL LEDGER" in text and "Initech" in text and "TEST MODE" in text
    assert "Usage" in handler("help")
