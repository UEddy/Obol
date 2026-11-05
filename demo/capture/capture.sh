#!/usr/bin/env bash
# Run one VHS tape against a real Hermes + Obol + Stripe test-mode setup.
#   OBOL_DEMO_HOME=/path/to/hermes-home demo/capture/capture.sh tapes/trigger.tape
# Needs: hermes (0.22+) on PATH, vhs + ttyd, a Stripe TEST key in STRIPE_API_KEY or STRIPE_SECRET_KEY,
# and the model key the demo home's provider reads (MODEL_API_KEY for Meta Muse). Keys stay in the
# environment; tapes never contain them. Prints the model spend afterwards (demo/capture/cost.py).
set -euo pipefail
cd "$(dirname "$0")"
: "${OBOL_DEMO_HOME:?set OBOL_DEMO_HOME to the demo Hermes home (outside the repo)}"
export HERMES_HOME="$OBOL_DEMO_HOME"
export STRIPE_API_KEY="${STRIPE_API_KEY:-${STRIPE_SECRET_KEY:-}}"
case "$STRIPE_API_KEY" in sk_test_*|rk_test_*) ;; *) echo "refusing: STRIPE_API_KEY must be a Stripe TEST key" >&2; exit 2;; esac
mkdir -p out /tmp/obol-demo
"${VHS:-vhs}" "$1"   # VHS=path/to/vhs-patched (see vhs-screen-wait.patch)
python3 cost.py "$HERMES_HOME" "${OBOL_BUDGET_USD:-3}"
