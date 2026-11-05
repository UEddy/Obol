# Capturing the demo footage

Everything in the video is recorded from a real run: Hermes CLI sessions with VHS, Hermes's Telegram gateway
through Telegram Web, and Stripe's hosted invoice page, both with Playwright. Stripe is in test mode throughout.

## One-time setup

- A Hermes home **outside the repo** (so `hermes plugins validate` doesn't scan it) with Obol installed. Set
  `OBOL_DEMO_HOME` to its path. Its `config.yaml`:

  ```yaml
  plugins:
    enabled: [obol]
  display: { compact: true }
  skills: { creation_nudge_interval: 0 }      # no self-made skills between takes
  agent: { disabled_toolsets: [clarify] }     # the model asks in text, so tapes can wait on it
  ```

- Model: the demo used Meta Muse Spark 1.3 (`MODEL_API_KEY`). `cost.py` reports spend after each tape.
- A Stripe **test** key in `STRIPE_API_KEY`. `python demo/seed_stripe.py` builds the client history.
- VHS 0.12.1 has a bug where `Wait+Screen` reads the top of the scrollback; build it with
  `vhs-screen-wait.patch` and pass the binary as `VHS=...`.
- Terminal tapes use `tapes/_phone.tape`: a narrow terminal with large type, so a few zoomed lines read on a phone.

## Order of a full capture

```bash
export OBOL_DEMO_HOME=/path/to/demo-home
python demo/capture/reset_demo_client.py           # void open invoices for the demo addresses
demo/capture/reset_obol_log.sh                     # fresh Obol log
python demo/capture/pay_when_sent.py billing@acmestudio.example.com demo/capture/out &   # pays once it's sent
demo/capture/capture.sh tapes/send_and_paid.tape   # forwarded message, draft, approval, sent
demo/capture/capture.sh tapes/have_they_paid.tape  # same session: "Have they paid?"
node demo/capture/paid_view.js <hosted-invoice-url> demo/capture/out   # the "Invoice paid" page
demo/capture/capture.sh tapes/scam.tape            # lookalike + injected instructions, denied; /invoices
```

The Telegram footage is captured with `telegram/` (see its README). Then copy the clips into
`demo/remotion/public/captures/` and render (`npm run render` and `npm run render:vertical` in `demo/remotion`).
Takes depend on a live model, so a tape can time out when the model words a reply differently; re-run it
after `reset_demo_client.py`, and check the shot timings in `demo/remotion/src/Demo.tsx` against new clips.
