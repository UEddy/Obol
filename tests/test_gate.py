from obol_lib import gate

CREATE = {"customer_email": "billing@pinemoor.test", "customer_name": "Pinemoor Labs",
          "line_items": [{"description": "October consulting", "amount": 1200}], "send": True}


def _decide(tool="obol_create_invoice", args=CREATE, mode="test", allow_live=False, unattended=False, flags=()):
    return gate.decide(tool, args, mode=mode, allow_live=allow_live, unattended=unattended,
                       summary=lambda: gate.describe_create(args, "usd"), assess=lambda: list(flags))


def test_reads_pass_through():
    for tool in ("obol_get_invoice", "obol_list_invoices", "obol_draft_from_message", "terminal"):
        assert _decide(tool=tool) is None


def test_every_write_asks_including_drafts():
    for tool in gate.WRITE_TOOLS:
        d = _decide(tool=tool)
        assert d["action"] == "approve", tool
    draft = _decide(args={**CREATE, "send": False})
    assert draft["action"] == "approve" and "draft" in draft["message"].lower()


def test_message_names_amount_client_and_mode():
    d = _decide()
    assert "$1,200.00" in d["message"] and "billing@pinemoor.test" in d["message"] and "TEST mode" in d["message"]


def test_rule_key_is_unique_per_call():
    assert _decide()["rule_key"] != _decide()["rule_key"]


def test_live_key_blocked_unless_allowed():
    blocked = _decide(mode="live")
    assert blocked["action"] == "block" and "LIVE" in blocked["message"]
    allowed = _decide(mode="live", allow_live=True)
    assert allowed["action"] == "approve" and "LIVE MONEY" in allowed["message"]


def test_unattended_runs_are_blocked_cleanly():
    d = _decide(unattended=True)
    assert d["action"] == "block" and "unattended" in d["message"] and "Nothing was sent" in d["message"]


def test_missing_key_lets_tool_report_it():
    assert _decide(mode="missing") is None


def test_flags_shown_and_broken_checks_do_not_hide_prompt():
    d = _decide(flags=[{"severity": "high", "message": "Possible duplicate of OBOL-0001"}])
    assert "[HIGH] Possible duplicate" in d["message"]

    def boom():
        raise RuntimeError("x")
    d = gate.decide("obol_void_invoice", {"invoice_id": "in_1"}, mode="test", allow_live=False, unattended=False,
                    summary=lambda: "void", assess=boom)
    assert d["action"] == "approve" and "could not run" in d["message"]


def test_unreadable_amount_still_asks():
    d = _decide(args={**CREATE, "line_items": [{"description": "x", "amount": "lots"}]})
    assert d["action"] == "approve" and "could not be read" in d["message"]
