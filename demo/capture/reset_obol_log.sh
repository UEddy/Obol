#!/usr/bin/env bash
# Give the demo Hermes home a fresh Obol log (invoices re-sync from Stripe), so the Security tab shows only
# the takes that follow. Stops the demo gateway; restart the dashboard afterwards.
set -euo pipefail
: "${OBOL_DEMO_HOME:?set OBOL_DEMO_HOME}"
pid=$(grep -o '"pid": [0-9]*' "$OBOL_DEMO_HOME/gateway.pid" 2>/dev/null | grep -o '[0-9]*' || true)
[ -n "$pid" ] && kill "$pid" 2>/dev/null || true
d="$OBOL_DEMO_HOME/plugin-data/obol"
[ -f "$d/data.db" ] && mv "$d/data.db" "$d/data.db.$(date +%s).bak"
rm -f "$d"/data.db-wal "$d"/data.db-shm
echo "Obol log reset in $d"
