"""Local SQLite cache of invoices plus an append-only activity ledger.

Tools write through it after every Stripe call; ``/invoices``, ``hermes obol ledger`` and the
approval prompt read from it (fast, works offline, never blocks on Stripe). Stripe stays the
source of truth: a row is always the last invoice object Stripe returned.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from typing import Any, Iterable, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS invoices (
    id               TEXT PRIMARY KEY,
    number           TEXT,
    customer_id      TEXT,
    customer_name    TEXT,
    customer_email   TEXT,
    description      TEXT,
    currency         TEXT NOT NULL,
    amount_due       INTEGER NOT NULL DEFAULT 0,
    amount_paid      INTEGER NOT NULL DEFAULT 0,
    amount_remaining INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL,
    due_date         INTEGER,
    created          INTEGER,
    paid_at          INTEGER,
    hosted_url       TEXT,
    pdf_url          TEXT,
    livemode         INTEGER NOT NULL DEFAULT 0,
    synced_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_status ON invoices(status);
CREATE TABLE IF NOT EXISTS events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    invoice_id TEXT,
    kind       TEXT NOT NULL,
    detail     TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS invoice_risk (
    invoice_id  TEXT PRIMARY KEY,
    flags       TEXT NOT NULL,
    assessed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    check_name TEXT NOT NULL,
    severity   TEXT NOT NULL,
    outcome    TEXT NOT NULL,
    invoice_id TEXT,
    ref        TEXT,
    detail     TEXT
);
CREATE TABLE IF NOT EXISTS security_links (
    ref        TEXT NOT NULL,
    invoice_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intake_flags (
    key   TEXT NOT NULL,
    at    INTEGER NOT NULL,
    flags TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_risk (
    fingerprint TEXT PRIMARY KEY,
    flags       TEXT NOT NULL,
    at          INTEGER NOT NULL
);
"""

STATUSES = ("draft", "open", "paid", "void", "uncollectible")

# Hash-chained (tamper-evident) tables and the fields each entry's hash covers, in order.
CHAINED = {
    "events": ("at", "invoice_id", "kind", "detail"),
    "security_events": ("at", "check_name", "severity", "outcome", "invoice_id", "ref", "detail"),
}
GENESIS = "0" * 64


def entry_hash(prev: str, values: list) -> str:
    return hashlib.sha256((prev + json.dumps(values, separators=(",", ":"), ensure_ascii=False)).encode()).hexdigest()


def row_from_invoice(inv: dict, now: Optional[int] = None) -> dict[str, Any]:
    customer = inv.get("customer")
    customer_id = customer.get("id") if isinstance(customer, dict) else customer
    transitions = inv.get("status_transitions") or {}
    return {
        "id": inv["id"],
        "number": inv.get("number"),
        "customer_id": customer_id,
        "customer_name": inv.get("customer_name"),
        "customer_email": inv.get("customer_email"),
        "description": inv.get("description"),
        "currency": (inv.get("currency") or "usd").lower(),
        "amount_due": int(inv.get("amount_due") or 0),
        "amount_paid": int(inv.get("amount_paid") or 0),
        "amount_remaining": int(inv.get("amount_remaining") or 0),
        "status": inv.get("status") or "draft",
        "due_date": inv.get("due_date"),
        "created": inv.get("created"),
        "paid_at": transitions.get("paid_at"),
        "hosted_url": inv.get("hosted_invoice_url"),
        "pdf_url": inv.get("invoice_pdf"),
        "livemode": 1 if inv.get("livemode") else 0,
        "synced_at": int(now if now is not None else time.time()),
    }


def is_overdue(row: dict, now: Optional[float] = None) -> bool:
    due = row.get("due_date")
    return row.get("status") == "open" and bool(due) and int(due) < int(now or time.time())


def display_status(row: dict, now: Optional[float] = None) -> str:
    return "overdue" if is_overdue(row, now) else str(row.get("status"))


class Store:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            for table in CHAINED:  # upgrade older databases, then seal any unhashed rows in order
                cols = {r[1] for r in self._conn.execute(f"PRAGMA table_info({table})")}
                for col in ("prev_hash", "hash"):
                    if col not in cols:
                        self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
                self._seal_unhashed(table)
            self._conn.commit()

    # -- hash chain -------------------------------------------------------------------------------
    def _head(self, table: str) -> str:
        row = self._conn.execute(f"SELECT hash FROM {table} WHERE hash IS NOT NULL ORDER BY seq DESC LIMIT 1").fetchone()
        if row:
            return row[0]
        anchor = self._conn.execute("SELECT value FROM meta WHERE key = ?", (f"anchor:{table}",)).fetchone()
        return anchor[0] if anchor else GENESIS

    def _seal_unhashed(self, table: str) -> None:
        fields = CHAINED[table]
        prev = None
        for row in self._conn.execute(f"SELECT seq, {', '.join(fields)} FROM {table} WHERE hash IS NULL ORDER BY seq").fetchall():
            prev = prev or self._head(table)
            h = entry_hash(prev, list(row[1:]))
            self._conn.execute(f"UPDATE {table} SET prev_hash = ?, hash = ? WHERE seq = ?", (prev, h, row[0]))
            prev = h
        if prev:
            self._set_meta_unlocked(f"count:{table}", str(self._count(table)))

    def _count(self, table: str) -> int:
        return self._conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def _set_meta_unlocked(self, key: str, value: str) -> None:
        self._conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                           (key, value))

    def _chain_insert(self, table: str, values: dict) -> None:
        """Insert one entry whose hash covers the previous entry's hash (caller holds the lock)."""
        fields = CHAINED[table]
        vals = [values.get(f) for f in fields]
        prev = self._head(table)
        h = entry_hash(prev, vals)
        self._conn.execute(f"INSERT INTO {table} ({', '.join(fields)}, prev_hash, hash) VALUES ({', '.join('?' * (len(fields) + 2))})",
                           (*vals, prev, h))
        self._set_meta_unlocked(f"count:{table}", str(self._count(table)))

    def _prune(self, table: str, keep: int) -> None:
        """Drop the oldest entries but keep the chain verifiable: the last dropped hash becomes the anchor."""
        cutoff = self._conn.execute(f"SELECT MAX(seq) - ? FROM {table}", (keep,)).fetchone()[0]
        if cutoff is None or cutoff <= 0:
            return
        last = self._conn.execute(f"SELECT hash FROM {table} WHERE seq <= ? ORDER BY seq DESC LIMIT 1", (cutoff,)).fetchone()
        if last:
            self._set_meta_unlocked(f"anchor:{table}", last[0])
            self._conn.execute(f"DELETE FROM {table} WHERE seq <= ?", (cutoff,))
            self._set_meta_unlocked(f"count:{table}", str(self._count(table)))

    def verify_chain(self, table: str = "events") -> dict[str, Any]:
        """Recompute every hash. Detects edited, deleted, reordered or truncated entries made by anything that
        does not rewrite the whole chain."""
        fields = CHAINED[table]
        with self._lock:
            anchor = self._conn.execute("SELECT value FROM meta WHERE key = ?", (f"anchor:{table}",)).fetchone()
            expected_count = self._conn.execute("SELECT value FROM meta WHERE key = ?", (f"count:{table}",)).fetchone()
            rows = self._conn.execute(f"SELECT seq, {', '.join(fields)}, prev_hash, hash FROM {table} ORDER BY seq").fetchall()
        prev = anchor[0] if anchor else GENESIS
        for row in rows:
            seq, vals, prev_hash, h = row[0], list(row[1:1 + len(fields)]), row[-2], row[-1]
            if prev_hash != prev or h != entry_hash(prev, vals):
                return {"ok": False, "entries": len(rows), "first_bad_seq": seq, "head": None}
            prev = h
        if expected_count is not None and int(expected_count[0]) != len(rows):
            return {"ok": False, "entries": len(rows), "first_bad_seq": None, "head": None,
                    "reason": f"expected {expected_count[0]} entries, found {len(rows)} (entries removed)"}
        return {"ok": True, "entries": len(rows), "first_bad_seq": None, "head": prev}

    @classmethod
    def memory(cls) -> "Store":
        return cls(sqlite3.connect(":memory:", check_same_thread=False))

    def _rows(self, sql: str, args: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            cur = self._conn.execute(sql, tuple(args))
            cols = [c[0] for c in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]

    def upsert(self, invoices: Iterable[dict], now: Optional[int] = None) -> int:
        rows = [row_from_invoice(i, now) for i in invoices if isinstance(i, dict) and i.get("id")]
        if not rows:
            return 0
        cols = list(rows[0])
        sql = (f"INSERT INTO invoices ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)}) "
               f"ON CONFLICT(id) DO UPDATE SET {', '.join(f'{c}=excluded.{c}' for c in cols if c != 'id')}")
        with self._lock:
            self._conn.executemany(sql, [tuple(r[c] for c in cols) for r in rows])
            self._conn.commit()
        return len(rows)

    def remove(self, invoice_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM invoices WHERE id = ?", (invoice_id,))
            self._conn.commit()

    def log(self, kind: str, invoice_id: Optional[str] = None, detail: str = "", at: Optional[int] = None) -> None:
        with self._lock:
            self._chain_insert("events", {"at": int(at or time.time()), "invoice_id": invoice_id, "kind": kind,
                                          "detail": detail[:500]})
            self._prune("events", 1000)
            self._conn.commit()

    def set_meta(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) "
                               "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
            self._conn.commit()

    def get_meta(self, key: str) -> Optional[str]:
        rows = self._rows("SELECT value FROM meta WHERE key = ?", (key,))
        return rows[0]["value"] if rows else None

    # -- risk flags -----------------------------------------------------------------------------
    def set_risk(self, invoice_id: str, flags: list[dict]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO invoice_risk (invoice_id, flags, assessed_at) VALUES (?, ?, ?) "
                "ON CONFLICT(invoice_id) DO UPDATE SET flags = excluded.flags, assessed_at = excluded.assessed_at",
                (invoice_id, json.dumps(flags), int(time.time())))
            self._conn.commit()

    def risk(self, invoice_ids: Iterable[str]) -> dict[str, list[dict]]:
        ids = list(invoice_ids)
        if not ids:
            return {}
        rows = self._rows(f"SELECT invoice_id, flags FROM invoice_risk WHERE invoice_id IN ({','.join('?' for _ in ids)})", ids)
        return {r["invoice_id"]: json.loads(r["flags"]) for r in rows}

    def stash_pending_risk(self, fingerprint: str, flags: list[dict]) -> None:
        """The approval hook runs before the invoice exists; park its findings until the tool creates it."""
        now = int(time.time())
        with self._lock:
            self._conn.execute("DELETE FROM pending_risk WHERE at < ?", (now - 3600,))
            self._conn.execute("INSERT INTO pending_risk (fingerprint, flags, at) VALUES (?, ?, ?) "
                               "ON CONFLICT(fingerprint) DO UPDATE SET flags = excluded.flags, at = excluded.at",
                               (fingerprint, json.dumps(flags), now))
            self._conn.commit()

    def pop_pending_risk(self, fingerprint: str) -> Optional[list[dict]]:
        rows = self._rows("SELECT flags FROM pending_risk WHERE fingerprint = ?", (fingerprint,))
        if not rows:
            return None
        with self._lock:
            self._conn.execute("DELETE FROM pending_risk WHERE fingerprint = ?", (fingerprint,))
            self._conn.commit()
        return json.loads(rows[0]["flags"])

    # -- security events ------------------------------------------------------------------------
    def record_security(self, check: str, severity: str, outcome: str, detail: str,
                        invoice_id: Optional[str] = None, ref: Optional[str] = None, at: Optional[int] = None) -> None:
        """outcome: 'flagged' (shown in an approval prompt), 'withheld' (intake refused to auto-fill),
        'blocked' (the hook refused the call)."""
        with self._lock:
            self._chain_insert("security_events", {"at": int(at or time.time()), "check_name": check, "severity": severity,
                                                   "outcome": outcome, "invoice_id": invoice_id, "ref": ref,
                                                   "detail": detail[:500]})
            self._prune("security_events", 5000)
            self._conn.commit()

    def link_security_ref(self, ref: str, invoice_id: str) -> None:
        """Link earlier flagged events (by approval fingerprint) to the invoice created from them. Stored apart
        from the chained rows so the chain never has to change."""
        with self._lock:
            self._conn.execute("INSERT INTO security_links (ref, invoice_id) VALUES (?, ?)", (ref, invoice_id))
            self._conn.commit()

    def security_events(self, limit: int = 100) -> list[dict]:
        return self._rows(
            "SELECT e.seq, e.at, e.check_name, e.severity, e.outcome, e.ref, e.detail, "
            "COALESCE(e.invoice_id, (SELECT l.invoice_id FROM security_links l WHERE l.ref = e.ref LIMIT 1)) AS invoice_id "
            "FROM security_events e ORDER BY e.seq DESC LIMIT ?", (max(1, min(limit, 1000)),))

    def stash_intake_flags(self, keys: Iterable[str], flags: list[dict]) -> None:
        now = int(time.time())
        with self._lock:
            self._conn.execute("DELETE FROM intake_flags WHERE at < ?", (now - 6 * 3600,))
            for k in {k.strip().lower() for k in keys if k and k.strip()}:
                self._conn.execute("INSERT INTO intake_flags (key, at, flags) VALUES (?, ?, ?)", (k, now, json.dumps(flags)))
            self._conn.commit()

    def recent_intake_flags(self, keys: Iterable[str], within: int = 6 * 3600) -> list[dict]:
        ks = [k.strip().lower() for k in keys if k and k.strip()]
        if not ks:
            return []
        rows = self._rows(f"SELECT flags FROM intake_flags WHERE at >= ? AND key IN ({','.join('?' for _ in ks)}) "
                          "ORDER BY at DESC LIMIT 1", [int(time.time()) - within, *ks])
        return json.loads(rows[0]["flags"]) if rows else []

    def all_emails(self) -> set[str]:
        rows = self._rows("SELECT DISTINCT lower(customer_email) AS e FROM invoices WHERE customer_email IS NOT NULL")
        return {r["e"] for r in rows if r["e"]}

    def emails_for_name(self, name: str) -> set[str]:
        """Billing emails previously used for a client name (case-insensitive)."""
        rows = self._rows("SELECT DISTINCT lower(customer_email) AS e FROM invoices "
                          "WHERE lower(customer_name) = lower(?) AND customer_email IS NOT NULL", (name.strip(),))
        return {r["e"] for r in rows if r["e"]}

    def get(self, invoice_id: str) -> Optional[dict]:
        rows = self._rows("SELECT * FROM invoices WHERE id = ?", (invoice_id,))
        return rows[0] if rows else None

    def invoices(self, *, status: Optional[str] = None, customer_email: Optional[str] = None,
                 livemode: Optional[bool] = None, limit: int = 200, now: Optional[float] = None) -> list[dict]:
        clauses, args = [], []
        if status == "overdue":
            clauses.append("status = 'open' AND due_date IS NOT NULL AND due_date < ?")
            args.append(int(now or time.time()))
        elif status == "outstanding":
            clauses.append("status = 'open'")
        elif status:
            clauses.append("status = ?")
            args.append(status)
        if customer_email:
            clauses.append("lower(customer_email) = lower(?)")
            args.append(customer_email)
        if livemode is not None:
            clauses.append("livemode = ?")
            args.append(1 if livemode else 0)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        args.append(max(1, min(int(limit), 1000)))
        return self._rows(f"SELECT * FROM invoices {where} ORDER BY created DESC LIMIT ?", args)

    def events(self, limit: int = 30) -> list[dict]:
        return self._rows("SELECT * FROM events ORDER BY seq DESC LIMIT ?", (max(1, min(limit, 200)),))

    def summary(self, *, livemode: Optional[bool] = None, now: Optional[float] = None) -> dict[str, Any]:
        """Totals per currency: outstanding / overdue / paid / draft, with counts."""
        now = now or time.time()
        out: dict[str, dict[str, Any]] = {}
        for row in self.invoices(livemode=livemode, limit=1000, now=now):
            cur = out.setdefault(row["currency"], {
                "outstanding": 0, "overdue": 0, "paid": 0, "draft": 0,
                "count_outstanding": 0, "count_overdue": 0, "count_paid": 0, "count_draft": 0})
            status = row["status"]
            if status == "open":
                cur["outstanding"] += row["amount_remaining"]
                cur["count_outstanding"] += 1
                if is_overdue(row, now):
                    cur["overdue"] += row["amount_remaining"]
                    cur["count_overdue"] += 1
            elif status == "paid":
                cur["paid"] += row["amount_paid"]
                cur["count_paid"] += 1
            elif status == "draft":
                cur["draft"] += row["amount_due"]
                cur["count_draft"] += 1
        return out
