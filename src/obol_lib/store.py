"""Local SQLite cache of invoices plus an append-only activity ledger.

Tools write through it after every Stripe call; ``/invoices``, ``hermes obol ledger`` and the
approval prompt read from it (fast, works offline, never blocks on Stripe). Stripe stays the
source of truth: a row is always the last invoice object Stripe returned.
"""

from __future__ import annotations

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
"""

STATUSES = ("draft", "open", "paid", "void", "uncollectible")


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
            self._conn.commit()

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
            self._conn.execute("INSERT INTO events (at, invoice_id, kind, detail) VALUES (?, ?, ?, ?)",
                               (int(at or time.time()), invoice_id, kind, detail[:500]))
            self._conn.execute("DELETE FROM events WHERE seq <= (SELECT MAX(seq) - 1000 FROM events)")
            self._conn.commit()

    def set_meta(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute("INSERT INTO meta (key, value) VALUES (?, ?) "
                               "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
            self._conn.commit()

    def get_meta(self, key: str) -> Optional[str]:
        rows = self._rows("SELECT value FROM meta WHERE key = ?", (key,))
        return rows[0]["value"] if rows else None

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
