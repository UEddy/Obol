"""Tamper-evident (hash-chained) activity and security logs."""

import sqlite3

import pytest

from obol_lib.store import Store


@pytest.fixture
def conn():
    return sqlite3.connect(":memory:", check_same_thread=False)


def _filled(conn, n=5):
    st = Store(conn)
    for i in range(n):
        st.log("sent", f"in_{i}", f"to client{i}@example.com", at=1_000 + i)
    return st


def test_intact_chain_verifies(conn):
    st = _filled(conn)
    v = st.verify_chain("events")
    assert v["ok"] and v["entries"] == 5 and len(v["head"]) == 64


def test_edited_entry_is_detected(conn):
    st = _filled(conn)
    conn.execute("UPDATE events SET detail = 'to attacker@evil.example' WHERE seq = 3"); conn.commit()
    v = st.verify_chain("events")
    assert not v["ok"] and v["first_bad_seq"] == 3


def test_deleted_middle_entry_is_detected(conn):
    st = _filled(conn)
    conn.execute("DELETE FROM events WHERE seq = 2"); conn.commit()
    assert not st.verify_chain("events")["ok"]


def test_truncated_tail_is_detected(conn):
    st = _filled(conn)
    conn.execute("DELETE FROM events WHERE seq = 5"); conn.commit()
    v = st.verify_chain("events")
    assert not v["ok"] and "removed" in v["reason"]


def test_reordered_timestamps_are_detected(conn):
    st = _filled(conn)
    conn.execute("UPDATE events SET at = 1 WHERE seq = 4"); conn.commit()
    assert st.verify_chain("events")["first_bad_seq"] == 4


def test_pruning_keeps_the_chain_verifiable(conn):
    st = Store(conn)
    for i in range(1_010):
        st.log("synced", None, str(i))
    v = st.verify_chain("events")
    assert v["ok"] and v["entries"] <= 1_001


def test_security_log_is_chained_and_links_do_not_break_it(conn):
    st = Store(conn)
    st.record_security("lookalike_domain", "high", "flagged", "acrne.example.com", ref="fp1")
    st.link_security_ref("fp1", "in_123")
    assert st.verify_chain("security_events")["ok"]
    assert st.security_events()[0]["invoice_id"] == "in_123"
    conn.execute("UPDATE security_events SET outcome = 'ignored'"); conn.commit()
    assert not st.verify_chain("security_events")["ok"]


def test_upgrade_seals_old_unhashed_rows(conn):
    conn.executescript("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, "
                       "invoice_id TEXT, kind TEXT NOT NULL, detail TEXT);"
                       "INSERT INTO events (at, kind, detail) VALUES (1, 'sent', 'a'), (2, 'paid', 'b');")
    st = Store(conn)                     # opening an older database adds and fills the hash columns
    st.log("created", None, "c")
    v = st.verify_chain("events")
    assert v["ok"] and v["entries"] == 3
