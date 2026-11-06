#!/usr/bin/env bash
# Terminal stills and the activity-log page for the paper-desk demo.
#   OBOL_DEMO_HOME=... STRIPE_API_KEY=sk_test_... VHS=path/to/vhs demo/capture/paper_terminal.sh <out-dir>
# 1. ledger.json: the latest activity-log entries from the demo home (the ledger-book page), and the entry to edit.
# 2. paper_ledger.png: `hermes obol ledger` (same cache, so the same totals as the dashboard shot).
# 3. paper_doctor.png: `hermes obol doctor` on a COPY of the demo home whose log has that one entry edited.
#    The demo home itself is never edited.
set -euo pipefail
out=$(realpath "$1"); here=$(cd "$(dirname "$0")" && pwd); home=${OBOL_DEMO_HOME:?}
mkdir -p "$out" "$here/out"
db="$home/plugin-data/obol/data.db"
seq=$(python3 - "$db" "$out/ledger.json" <<'PY'
import json, sqlite3, sys, time
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
rows = [dict(seq=s, time=time.strftime("%H:%M", time.gmtime(at)), kind=k, detail=d or "", hash=h[:6])
        for s, at, k, d, h in c.execute("SELECT seq, at, kind, detail, hash FROM events WHERE kind != 'synced' ORDER BY seq DESC LIMIT 12")][::-1]
target = next(r for r in rows if r["kind"] == "created" and r["detail"].startswith("$2,350.00"))
json.dump({"source": "plugin-data/obol/data.db", "rows": rows, "tamper_seq": target["seq"], "tamper_text": "$23,500.00 for Acme Studio"},
          open(sys.argv[2], "w"), indent=1)
print(target["seq"])
PY
)
cd "$here"
HERMES_HOME="$home" "${VHS:-vhs}" tapes/paper_ledger.tape
copy=$(mktemp -d); trap 'rm -rf "$copy"' EXIT
cp "$home/config.yaml" "$copy/"; mkdir -p "$copy/plugins" "$copy/plugin-data/obol"
ln -s "$(readlink -f "$home/plugins/obol")" "$copy/plugins/obol"
# SQLite's backup API, not cp: recent entries may still be in the WAL file next to data.db.
python3 -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close()" "$db" "$copy/plugin-data/obol/data.db"
python3 -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); n=c.execute(\"UPDATE events SET detail='\$23,500.00 for Acme Studio' WHERE seq=?\", (int(sys.argv[2]),)).rowcount; c.commit(); assert n == 1" "$copy/plugin-data/obol/data.db" "$seq"
HERMES_HOME="$copy" "${VHS:-vhs}" tapes/paper_doctor.tape
cp out/paper_ledger.png "$out/term_tab.png"; cp out/paper_doctor.png "$out/term_doctor.png"
echo "edited entry #$seq in a copy; stills in $out"
