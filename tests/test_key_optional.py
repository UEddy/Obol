"""STRIPE_API_KEY is optional: bank-transfer users are never asked for it, and Stripe mode without it answers
"Stripe key not set" from every surface (tools, the approval hook, /invoices, the doctor) instead of crashing.

Each mode is checked with and without the key, through Hermes's real plugin manager.
"""

from __future__ import annotations

import contextlib
import os
import sys
import types
from pathlib import Path

import pytest

pytest.importorskip("hermes_cli.plugins")

from test_hermes_integration import ROOT, call, fake, hermes  # noqa: F401  (fixtures: Obol loaded by Hermes, Stripe fake)

STRIPE_TOOLS = {
    "obol_create_invoice": {"customer_email": "ap@globex.test", "line_items": [{"description": "x", "amount": 900}]},
    "obol_send_invoice": {"invoice_id": "in_1Abcdef"},
    "obol_get_invoice": {"invoice_id": "in_1Abcdef"},
    "obol_list_invoices": {},
    "obol_send_reminder": {"invoice_id": "in_1Abcdef"},
    "obol_void_invoice": {"invoice_id": "in_1Abcdef"},
    "obol_mark_paid": {"invoice_id": "in_1Abcdef"},
}
CREATE = {"customer_email": "billing@acmestudio.example.com", "customer_name": "Acme Studio", "send": True,
          "line_items": [{"description": "Website build", "amount": 1800}]}


@contextlib.contextmanager
def no_key():
    saved = os.environ.pop("STRIPE_API_KEY", None)
    try:
        yield
    finally:
        if saved is not None:
            os.environ["STRIPE_API_KEY"] = saved


@contextlib.contextmanager
def bank_mode():
    cfg = Path(os.environ["HERMES_HOME"]) / "config.yaml"
    original = cfg.read_text()
    cfg.write_text(original.replace("default_currency: usd\n", "default_currency: usd\n        provider: bank_transfer\n"
                                    "        bank_account_name: Dana Okafor\n        bank_account_number: '0123456789'\n"))
    try:
        yield
    finally:
        cfg.write_text(original)


def _plugin():
    return sys.modules["hermes_plugins.obol"]


def _hook(tool_name, args):
    from hermes_cli.plugins import invoke_hook
    return next((r for r in invoke_hook("pre_tool_call", tool_name=tool_name, args=args, task_id="t")
                 if isinstance(r, dict)), None)


def _command(text=""):
    from hermes_cli.plugins import get_plugin_command_handler
    return get_plugin_command_handler("invoices")(text)


def _doctor(capsys):
    from hermes_cli.config import load_config_readonly
    getter = lambda key, default=None: (((load_config_readonly().get("plugins") or {}).get("entries") or {})  # noqa: E731
                                        .get("obol", {}).get("settings", {}).get(key, default))
    code = _plugin()._make_cli(types.SimpleNamespace(get_config=getter))(types.SimpleNamespace(obol_command="doctor"))
    return code, capsys.readouterr().out


# -- install --------------------------------------------------------------------------------------
def test_install_never_asks_for_the_stripe_key():
    from ruamel.yaml import YAML
    from hermes_cli.plugins_cmd import _missing_env_specs
    yaml = YAML(typ="safe")
    manifest = yaml.load((ROOT / "plugin.yaml").read_text())
    assert not manifest.get("requires_env")
    assert [e["name"] for e in manifest["optional_env"]] == ["STRIPE_API_KEY"]
    with no_key():
        assert _missing_env_specs(manifest) == []                 # the install prompt has nothing to ask
    assert manifest["config_schema"]["stripe_api_key"] == {**manifest["config_schema"]["stripe_api_key"],
                                                          "type": "secret", "env": "STRIPE_API_KEY"}
    catalog = yaml.load((ROOT / "catalog" / "obol.yaml").read_text())
    assert catalog["capabilities"]["requires_env"] == []


# -- Stripe mode ----------------------------------------------------------------------------------
def test_stripe_mode_without_key_every_tool_says_key_not_set(hermes, fake):
    with no_key():
        for tool, args in STRIPE_TOOLS.items():
            out = call(tool, dict(args))
            assert out["kind"] == "not_configured", (tool, out)
            assert "Stripe key not set" in out["error"] and "bank_transfer" in out["error"], tool
    assert fake.calls == []                                       # nothing reached Stripe


def test_stripe_mode_without_key_hook_slash_command_and_doctor(hermes, fake, capsys):
    with no_key():
        assert _hook("obol_create_invoice", dict(CREATE)) is None  # no prompt for a call that cannot run
        assert "OBOL LEDGER" in _command("")                      # the local ledger still works
        assert "Stripe key not set" in _command("sync")
        code, out = _doctor(capsys)
    assert code == 1 and "Payment key: missing (Stripe key not set" in out and "Traceback" not in out
    assert fake.calls == []


def test_stripe_mode_with_key_still_works(hermes, fake, capsys):
    assert os.environ.get("STRIPE_API_KEY", "").startswith("sk_test_")
    assert _hook("obol_create_invoice", dict(CREATE))["action"] == "approve"
    out = call("obol_create_invoice", dict(CREATE))
    assert out["invoice"]["status"] == "open" and out["payment_link"]
    code, text = _doctor(capsys)
    assert code == 0 and "Payment key: test" in text


# -- bank-transfer mode ---------------------------------------------------------------------------
def test_bank_mode_without_key_issues_marks_paid_and_reports(hermes, fake, capsys):
    with no_key(), bank_mode():
        directive = _hook("obol_create_invoice", dict(CREATE))
        assert directive["action"] == "approve" and "BANK TRANSFER" in directive["message"]
        out = call("obol_create_invoice", dict(CREATE))
        assert out.get("issued") is True and Path(out["invoice_pdf"]).read_bytes()[:5] == b"%PDF-"
        inv_id = out["invoice"]["invoice_id"]
        assert _hook("obol_mark_paid", {"invoice_id": inv_id})["action"] == "approve"
        assert call("obol_mark_paid", {"invoice_id": inv_id})["invoice"]["status"] == "paid"
        assert "OBOL LEDGER" in _command("sync")
        code, text = _doctor(capsys)
    assert code == 0 and "Provider: bank transfer" in text and "Stripe key not set" not in text
    assert fake.calls == []


def test_bank_mode_with_key_ignores_stripe(hermes, fake):
    assert os.environ.get("STRIPE_API_KEY")
    with bank_mode():
        out = call("obol_create_invoice", dict(CREATE))
        listed = call("obol_list_invoices", {})
        assert "BANK TRANSFER" in _command("")
    assert out["invoice"]["invoice_id"].startswith("in_bank") and out.get("issued") is True
    assert listed["invoices"] and all(i["invoice_id"].startswith("in_bank") for i in listed["invoices"])
    assert fake.calls == []                                       # the key is never used in bank mode
