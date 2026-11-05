# Obol

**Invoices and payment links from chat, for [Hermes Agent](https://github.com/NousResearch/hermes-agent).**

Tell Hermes *"Invoice billing@acme.com $1,200 for October consulting and send it"* and Obol
drafts a Stripe invoice, asks you to approve the send, and emails your client a payment link.
Ask *"has Acme paid?"* and it checks Stripe. Open the **Invoices** tab in the Hermes dashboard
and your receivables are laid out as index cards: unpaid, overdue, paid. When a payment
lands, the card gets stamped **PAID**.

Obol runs in **Stripe test mode by default**. Live keys are refused until you turn live mode on.

## What it adds to Hermes

| Surface | What you get |
|---|---|
| **Tools** | `obol_create_invoice`, `obol_send_invoice`, `obol_get_invoice`, `obol_list_invoices`, `obol_send_reminder`, `obol_void_invoice` |
| **Approval hook** | A `pre_tool_call` hook sends every send, reminder and void through Hermes's approval prompt, naming the amount, client and mode |
| **Dashboard tab** | *Invoices*: totals, filterable invoice cards with status stamps, an activity ledger, and auto-sync while the tab is open |
| **Dashboard slot** | A receivables strip at the top of the *Analytics* page |
| **Slash command** | `/invoices [open\|overdue\|paid\|draft\|sync]`: the ledger as text, in the CLI, TUI, Desktop, Telegram, Discord, Slack… |
| **CLI** | `hermes obol doctor` (key, mode, connectivity), `hermes obol sync`, `hermes obol ledger` |
| **Automation** | *Chase overdue invoices*: a weekly blueprint that reminds late payers and reports back |
| **Skill** | `obol:invoicing`: guidance the agent loads for invoicing work (exact emails, drafts by default, no double-billing) |

## Install

```bash
hermes plugins install ueddy/obol     # prompts for STRIPE_API_KEY
hermes plugins enable obol
hermes obol doctor                    # checks the key and that Stripe is reachable
```

You need a Stripe account (free) and its **test** secret key from
<https://dashboard.stripe.com/test/apikeys>. It starts with `sk_test_`. A restricted key
(`rk_test_`) works too if it can read and write Customers, Invoices and Invoice Items.

Restart the dashboard (or open *Plugins → Rescan*) to see the **Invoices** tab.

Requires Hermes Agent 0.22.7 or newer. No extra Python packages: Obol uses the `httpx`
that ships with Hermes.

## Configure

Settings live under `plugins.entries.obol.settings` in `config.yaml`. They also appear as a form
on the plugin's page in Hermes Desktop (*Settings → Plugins → Obol*).

| Setting | Default | Meaning |
|---|---|---|
| `approval` | `always` | `always`: every send, reminder and void asks you first. `live_only`: ask only with a live key. `never`: no prompts (not recommended) |
| `allow_live` | `false` | Must be `true` before a `sk_live_` / `rk_live_` key is accepted. With it off, no real customer can be billed |
| `default_currency` | `usd` | Used when a request doesn't name a currency |
| `default_days_until_due` | `14` | Payment terms for new invoices |

The key itself is `STRIPE_API_KEY`. Hermes stores it in its `.env` and Obol reads it only
through Hermes's profile-aware secret route. Obol never writes or caches it.

## Try it

```text
You:    Invoice billing@acme.test (Acme Co) $1,200 for October consulting, net 14, and send it.
Hermes: [asks for approval: "Obol will email billing@acme.test a payment link for $1,200.00 (test mode)"]
        Sent OBOL-0001 to Acme Co: $1,200.00 due Nov 19. Payment link: https://invoice.stripe.com/i/…
You:    (open the link, pay with Stripe's test card 4242 4242 4242 4242)
You:    Has Acme paid?
Hermes: Yes. OBOL-0001 was paid in full ($1,200.00) at 14:02 UTC.
```

Other things to ask: *"What's overdue?"*, *"Remind Globex about their invoice"*,
*"Draft an invoice for Hooli: 3 hours of design at $95 and $20 hosting, don't send it yet"*,
*"Void OBOL-0004, it was a duplicate"*.

## How it stays safe and reliable

- **Approval before anything leaves.** Creating a draft is free. Sending, reminding and
  voiding go through Hermes's approval gate. Under cron or other unattended runs where nobody
  can approve, the call fails closed instead of sending.
- **Test mode by default.** Live keys are refused unless `allow_live: true`.
- **No double billing.** Every Stripe write carries an idempotency key that is reused when a
  timeout or 5xx is retried. On a timeout the tool tells the agent to check the list before
  trying again.
- **Validation before the network.** Emails, amounts (per-currency decimals, zero-decimal
  currencies like JPY), quantities, due dates and invoice ids are checked before any Stripe call.
  If adding a line item fails, the half-built draft is deleted.
- **Errors are answers, not crashes.** Every tool returns JSON with a short `kind`
  (`not_configured`, `live_blocked`, `auth`, `not_found`, `invalid_arguments`, `timeout`, …).
- **Pinned Stripe API version** (`2024-06-20`), so Stripe-side default changes don't move under you.
- **Stripe is the source of truth.** The local ledger is a cache of what Stripe last returned.
  The dashboard reads the cache and syncs in the background.

## What Obol touches (disclosure)

- **Network:** HTTPS calls to `api.stripe.com` only. They happen when a tool runs, on
  `/invoices sync`, on `hermes obol doctor|sync`, and while the dashboard's Invoices tab is
  open (an automatic sync every 45 seconds, plus the *Sync* button). No telemetry, no other hosts.
- **Emails to your clients:** sending and reminding make *Stripe* email the customer the
  invoice. Stripe's own test-mode rules decide what is delivered in test mode. Test mode never
  moves real money.
- **Credentials:** reads `STRIPE_API_KEY` through Hermes (`agent.secret_scope.get_secret`).
  It never reads `.env` or any other credential file itself.
- **Local data:** `<HERMES_HOME>/plugin-data/obol/data.db` (SQLite) holds a cache of invoice
  metadata (number, client name and email, amounts, status, due date, Stripe payment and PDF
  links) and an activity log of the last 1,000 actions. It follows the active profile and
  survives plugin updates. Delete the file to clear it.
- **No shell commands, no background processes** (auto-sync runs only in the open browser tab),
  and no self-updating code.

## Development

```bash
git clone https://github.com/ueddy/obol && cd obol
python -m pytest            # unit tests; the Hermes integration tests skip without Hermes
# inside a Hermes venv, the integration tests also load the plugin through Hermes:
/path/to/hermes-venv/bin/python -m pytest
hermes plugins validate . --install-deps
```

Tests run against an in-memory fake of the Stripe endpoints (`tests/fake_stripe.py`). It
honours idempotency keys and can inject 5xx responses and timeouts.

Layout:

```text
plugin.yaml             manifest: tools, hook, env, settings form
__init__.py             register(): tools, approval hook, /invoices, CLI, blueprint, skill
schemas.py              tool schemas the model reads
src/obol_lib/           Stripe client, money, ledger cache, operations (no Hermes imports at load)
dashboard/              manifest.json, plugin_api.py (FastAPI routes), dist/ (React via the plugin SDK)
skills/invoicing/       the obol:invoicing skill
tests/                  unit, dashboard-API and Hermes integration tests
```

## License

MIT
