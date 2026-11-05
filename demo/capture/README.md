# Capturing the demo footage

Everything in the video is recorded from a real run: Hermes CLI sessions with VHS, and Stripe's hosted
invoice page and the Obol dashboard with Playwright. Stripe is in test mode throughout.

## One-time setup

- A Hermes home **outside the repo** (so `hermes plugins validate` doesn't scan it) with Obol and the
  catalog plugin `agentwalletapi` installed. Set `OBOL_DEMO_HOME` to its path. Its `config.yaml`:

  ```yaml
  plugins:
    enabled: [obol, agentwalletapi, obol_demo_wallet_stub]
    entries:
      obol:
        settings:
          guard_tools: [agentwalletapi_transfer_send]
  dashboard: { theme: mono }
  display: { compact: true }
  skills: { creation_nudge_interval: 0 }      # no self-made skills between takes
  agent: { disabled_toolsets: [clarify] }     # the model asks in text, so tapes can wait on it
  ```

- Model: the demo used Meta Muse Spark 1.3 (`MODEL_API_KEY`). `cost.py` reports spend after each tape.
- A Stripe **test** key in `STRIPE_API_KEY`. `python demo/seed_stripe.py` builds the client history.
- VHS 0.12.1 has a bug where `Wait+Screen` reads the top of the scrollback; build it with
  `vhs-screen-wait.patch` and pass the binary as `VHS=...`.
- `wallet_stub.py` is installed by `capture.sh` as the demo-only plugin `obol_demo_wallet_stub`. It answers
  the wallet plugin's HTTP calls locally (one wallet, test USDC), because the demo has no OpenClawCash
  account. Obol Guard and `agentwalletapi` run unmodified, and the transfer is denied.

## Order of a full capture

```bash
export OBOL_DEMO_HOME=/path/to/demo-home
python demo/capture/reset_demo_client.py           # void open Pinemoor / lookalike invoices
demo/capture/reset_obol_log.sh                     # fresh Obol log, so the Security tab shows only this run
hermes dashboard --no-open --port 9120 &           # with HERMES_HOME=$OBOL_DEMO_HOME and the Stripe key
demo/capture/capture.sh tapes/trigger.tape         # beats 3-4: forwarded message, proposal, approval
node demo/capture/pay_and_flip.js <hosted-invoice-url> http://127.0.0.1:9120/invoices demo/capture/out
demo/capture/capture.sh tapes/attack.tape          # beats 5-6: "Has Pinemoor paid?", lookalike + injection
demo/capture/capture.sh tapes/guard.tape           # beats 7-8: Obol Guard, /invoices
node demo/capture/record_views.js http://127.0.0.1:9120/invoices demo/capture/out docs/screenshots
```

Then copy `out/*.mp4`, `out/*.webm` and `out/views.json` into `demo/remotion/public/captures/` and render
(`npm run render` and `npm run render:vertical` in `demo/remotion`). If you re-record, check the
timings in `demo/remotion/src/Demo.tsx` against the new clips. Takes depend on a live model, so a tape
can time out when the model words a reply differently. Re-run it after `reset_demo_client.py`.
