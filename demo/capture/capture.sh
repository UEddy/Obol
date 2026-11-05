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
export OPENCLAWCASH_AGENT_KEY="occ_demo_not_a_real_key"   # Guard beat: the wallet backend is the local stub below
case "$STRIPE_API_KEY" in sk_test_*|rk_test_*) ;; *) echo "refusing: STRIPE_API_KEY must be a Stripe TEST key" >&2; exit 2;; esac
mkdir -p out /tmp/obol-demo
cp files/* /tmp/obol-demo/ 2>/dev/null || true
# Demo-only wallet backend (no network, no funds); enable it with plugins.enabled in the demo home.
stub="$HERMES_HOME/plugins/obol_demo_wallet_stub"; mkdir -p "$stub"
cp wallet_stub.py "$stub/__init__.py"
printf 'name: obol_demo_wallet_stub\nversion: 0.0.1\ndescription: Demo-only canned OpenClawCash responses for the Obol Guard beat.\nprovides_hooks: [pre_tool_call]\n' > "$stub/plugin.yaml"
"${VHS:-vhs}" "$1"   # VHS=path/to/vhs-patched (see vhs-screen-wait.patch)
python3 cost.py "$HERMES_HOME" "${OBOL_BUDGET_USD:-3}"
