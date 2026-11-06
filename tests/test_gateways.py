"""Obol works wherever Hermes does: checked through Hermes's real gateway code paths.

For Telegram, WhatsApp, Slack and email (and the terminal), with Obol loaded by Hermes's plugin manager:

* the ``obol`` toolset is enabled on that platform's default toolset, so the model can call Obol's tools;
* a Stripe write called from a session on that platform goes through Hermes's real tool dispatch, Obol's
  ``pre_tool_call`` hook escalates it, and the approval request reaches that chat through the gateway's
  pending-approval path (the same one dangerous shell commands use); a deny there means nothing is sent;
* the approval text the platform renders (a button card where the adapter has one, the typed ``/approve``
  fallback otherwise) carries Obol's summary and risk checks;
* ``/invoices`` typed in that chat is dispatched by the gateway to Obol's command and answers with the ledger.
"""

from __future__ import annotations

import asyncio
import json
import os

import pytest

pytest.importorskip("gateway.run")

from test_hermes_integration import fake, hermes  # noqa: F401  (fixtures: Obol loaded by Hermes, Stripe fake)

PLATFORMS = ["telegram", "whatsapp", "slack", "email"]
CREATE = {"customer_email": "billing@acmestudio.example.com", "customer_name": "Acme Studio", "send": True,
          "line_items": [{"description": "Website build", "amount": 1800}]}


@pytest.mark.parametrize("platform", PLATFORMS + ["cli"])
def test_obol_tools_are_enabled_on_each_surface(hermes, platform):
    from hermes_cli.tools_config import _get_platform_tools
    assert "obol" in _get_platform_tools({}, platform)


@pytest.fixture
def gateway_session(monkeypatch):
    """A gateway session on a given platform, as Hermes binds one for an inbound chat message."""
    from tools import approval
    for key in ("HERMES_CRON_SESSION", "HERMES_YOLO_MODE", "HERMES_INTERACTIVE", "HERMES_EXEC_ASK"):
        monkeypatch.delenv(key, raising=False)
    approval._gateway_queues.clear()
    approval._gateway_notify_cbs.clear()
    approval._session_approved.clear()
    approval._pending.clear()

    def bind(platform: str, key: str):
        monkeypatch.setenv("HERMES_GATEWAY_SESSION", "1")
        monkeypatch.setenv("HERMES_SESSION_KEY", key)
        monkeypatch.setenv("HERMES_SESSION_PLATFORM", platform)
        return key
    yield bind
    approval._gateway_queues.clear()
    approval._gateway_notify_cbs.clear()


@pytest.mark.parametrize("platform", PLATFORMS)
def test_stripe_write_asks_for_approval_in_that_chat_and_deny_sends_nothing(hermes, fake, gateway_session, platform):
    from model_tools import handle_function_call
    from tools import approval
    key = gateway_session(platform, f"agent:main:{platform}:dm:client-chat")
    asked = []

    def notify(data):           # what the gateway turns into the chat's approval prompt
        asked.append(data)
        approval.resolve_gateway_approval(key, "deny")
    approval.register_gateway_notify(key, notify)
    try:
        out = json.loads(handle_function_call("obol_create_invoice", dict(CREATE), session_id=key, task_id="t"))
    finally:
        approval.unregister_gateway_notify(key)
    assert len(asked) == 1
    prompt = json.dumps(asked[0])
    assert "obol_create_invoice" in prompt and "$1,800.00" in prompt and "TEST mode" in prompt
    assert "error" in out and "BLOCKED" in out["error"]
    assert not [c for c in fake.calls if c[0] == "POST"]          # nothing reached Stripe


@pytest.mark.parametrize("platform", PLATFORMS)
def test_approve_in_that_chat_sends_the_invoice(hermes, fake, gateway_session, platform):
    from model_tools import handle_function_call
    from tools import approval
    key = gateway_session(platform, f"agent:main:{platform}:dm:client-chat-ok")
    approval.register_gateway_notify(key, lambda data: approval.resolve_gateway_approval(key, "once"))
    try:
        out = json.loads(handle_function_call("obol_create_invoice", dict(CREATE), session_id=key, task_id="t"))
    finally:
        approval.unregister_gateway_notify(key)
    assert out["invoice"]["status"] == "open" and out["invoice"]["amount_due"] == "$1,800.00"


def _obol_prompt():
    from hermes_cli.plugins import invoke_hook
    d = next(r for r in invoke_hook("pre_tool_call", tool_name="obol_create_invoice", args=dict(CREATE), task_id="t")
             if isinstance(r, dict))
    return "<obol_create_invoice> (plugin approval rule)", d["message"]


def test_button_cards_carry_obols_summary(hermes, fake):
    """Telegram, Slack and WhatsApp (Cloud API) render approvals as button cards; each keeps Obol's text."""
    import importlib
    command, reason = _obol_prompt()
    for mod in ("plugins.platforms.telegram.adapter", "plugins.platforms.slack.adapter",
                "plugins.platforms.whatsapp_cloud.adapter"):
        adapter_mod = importlib.import_module(mod)
        cls = next(v for k, v in vars(adapter_mod).items() if isinstance(v, type) and k.endswith("Adapter")
                   and hasattr(v, "_send_exec_approval_prompt") and v.__module__ == mod)
        card = cls._format_exec_approval(object.__new__(cls), command, reason)
        assert "obol_create_invoice" in card and "1,800.00" in card, mod


def test_text_fallback_carries_obols_summary_and_approve_steps(hermes, fake):
    """Surfaces without buttons (email, the WhatsApp bridge) get the typed /approve prompt."""
    from gateway.run import _format_exec_approval_fallback
    command, reason = _obol_prompt()
    text = _format_exec_approval_fallback(command, reason, "/")
    assert "obol_create_invoice" in text and "$1,800.00" in text and "/approve" in text and "/deny" in text


@pytest.mark.parametrize("platform", PLATFORMS)
def test_invoices_command_through_gateway_dispatch(hermes, fake, platform):
    from gateway.config import GatewayConfig, Platform, PlatformConfig
    from gateway.platforms.event import MessageEvent
    from gateway.run import GatewayRunner
    from gateway.session import SessionSource
    p = Platform(platform)
    runner = object.__new__(GatewayRunner)
    runner.config = GatewayConfig(platforms={p: PlatformConfig(enabled=True, token="***")})
    runner._draining = False
    source = SessionSource(platform=p, chat_id="c1", user_id="u1", user_name="you", chat_type="dm")
    event = MessageEvent(text="/invoices", source=source, message_id="m1")
    handled, reply, _ = asyncio.run(runner._hm_dispatch_quick_and_plugin_commands(event, source, event.get_command()))
    assert handled and "OBOL LEDGER" in reply


def test_slack_hermes_subcommand_routes_to_invoices(hermes):
    """In Slack, `/hermes invoices` maps to Obol's command (no Slack app manifest change needed)."""
    from plugins.platforms.slack.adapter_slash_payload import slash_command_text
    assert slash_command_text({"command": "/hermes", "text": "invoices overdue"}) == "/invoices overdue"


def test_email_body_command_without_subject_is_a_command():
    """Email turns a message into a command when the body starts with it and there's no new subject
    (an empty subject, or a reply)."""
    from gateway.platforms.event import MessageEvent
    assert MessageEvent(text="/invoices").get_command() == "invoices"
    assert MessageEvent(text="[Subject: Ledger]\n\n/invoices").get_command() is None
