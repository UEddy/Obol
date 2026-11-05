# Obol

**Stripe invoicing for [Hermes Agent](https://github.com/NousResearch/hermes-agent): invoices and payment links from chat.**

Forward a client's message and Hermes drafts the invoice. You approve it, and Stripe emails
your client a payment link. Ask *"has Acme paid?"* and Hermes checks Stripe. The **Invoices**
tab in the Hermes dashboard shows what's outstanding, paid and overdue. Before anything goes
out, Obol checks for duplicates, unusual amounts and recently changed client details, and
shows the results in the approval prompt.

Obol runs in **Stripe test mode by default**. Live keys are refused until you turn live mode on.

## What it adds to Hermes

| Surface | What you get |
|---|---|
| **Tools** | `obol_create_invoice`, `obol_send_invoice`, `obol_get_invoice`, `obol_list_invoices`, `obol_send_reminder`, `obol_void_invoice`, `obol_draft_from_message` |
| **Approval hook** | A `pre_tool_call` hook sends **every** Stripe write (create, send, remind, void) to Hermes's approval prompt, with the amount, client, mode and risk-check results |
| **Risk checks** | Possible duplicate, unusual amount, recent email or payment-details change. Shown in the prompt and the dashboard |
| **Message intake** | `obol_draft_from_message` turns a forwarded Telegram, WhatsApp, Slack or email message into a proposed invoice, using your Hermes model (`ctx.llm`) |
| **Dashboard tab** | *Invoices*: outstanding, overdue and paid totals, an invoice table with status and risk columns, an activity log and a TEST MODE badge |
| **Slash command** | `/invoices [open\|overdue\|paid\|draft\|sync]`: the ledger as text in the CLI, TUI, Desktop, Telegram, Discord, Slack and the other gateways |
| **CLI** | `hermes obol doctor` (key, mode, connectivity), `hermes obol sync`, `hermes obol ledger` |
| **Automation** | *Chase overdue invoices*: a weekly blueprint that reports who to chase. It never sends anything by itself |
| **Skill** | `obol:invoicing`: how the agent should invoice, use forwarded messages, and handle risk flags |

## Set up (Stripe test mode)

1. Create a free Stripe account. You don't need to activate payments for test mode.
2. In the Stripe dashboard, switch on **Test mode** and copy the secret key from
   <https://dashboard.stripe.com/test/apikeys>. It starts with `sk_test_`. A restricted key
   (`rk_test_`) also works if it can write Customers, Invoices and Invoice Items, and read Events.
3. Install and enable the plugin, then check it:

   ```bash
   hermes plugins install ueddy/obol     # asks for STRIPE_API_KEY
   hermes plugins enable obol
   hermes obol doctor                    # key mode, approval policy, Stripe reachable
   ```

4. Restart `hermes dashboard` to see the **Invoices** tab.

To pay a test invoice, open its payment link and use Stripe's test card
**4242 4242 4242 4242**, any future expiry date, any CVC and any postcode. No real money moves
in test mode. Stripe applies its own test-mode rules to invoice emails and may not deliver
them to real inboxes, so in a demo open the payment link that Hermes returns.

Requires Hermes Agent 0.22 or newer. Obol adds no Python dependencies: it calls Stripe's REST
API with the `httpx` that ships with Hermes, not the Stripe SDK.

## Configure

Settings live under `plugins.entries.obol.settings` in `config.yaml`. They also appear as a
form on the plugin's page in Hermes Desktop.

| Setting | Default | Meaning |
|---|---|---|
| `allow_live` | `false` | Must be `true` before a `sk_live_` / `rk_live_` key is accepted. While it's off, no real customer can be billed |
| `default_currency` | `usd` | Currency when a request doesn't name one |
| `default_days_until_due` | `14` | Payment terms for new invoices |
| `risk_duplicate_window_days` | `30` | Flag the same customer and amount within this many days. `0` turns it off |
| `risk_amount_multiplier` | `3.0` | Flag an amount above this multiple of the customer's average invoice. `0` turns it off |
| `risk_amount_min_history` | `3` | Past invoices a customer needs before the unusual-amount check applies |
| `risk_contact_change_days` | `14` | Flag a customer whose email or payment details changed in Stripe this recently (max 30). `0` turns it off |

The key itself is `STRIPE_API_KEY`. Hermes stores it in its own `.env`. Obol reads it only
through Hermes's secret route (`agent.secret_scope.get_secret`), and never logs, stores or
caches it.

## 90-second demo script

| Time | On screen | What happens |
|---|---|---|
| 0:00 | Telegram (or any Hermes chat) | Forward the client's message: *"Hi! Thanks for October. Please invoice billing@acme.test for 12 hours at $100/hr, net 14. — Dana, Acme Co"* and add: *"Bill this."* |
| 0:10 | Hermes reply | `obol_draft_from_message` proposes: Acme Co, billing@acme.test, 12 × $100.00 = **$1,200.00**, due in 14 days. Nothing is in Stripe yet |
| 0:20 | You: *"Looks right, send it."* | Hermes calls `obol_create_invoice` with `send: true`. The approval prompt reads *"Obol (Stripe TEST mode): Create and EMAIL billing@acme.test a payment link for $1,200.00. Risk checks: none raised."* |
| 0:28 | Approve | Hermes replies with the invoice number and the Stripe payment link |
| 0:35 | Open the link | Stripe's hosted invoice page for $1,200.00 |
| 0:45 | Pay | Card 4242 4242 4242 4242, any future date and CVC. Stripe shows *Paid* |
| 0:58 | You: *"Has Acme paid?"* | `obol_get_invoice` answers: paid in full, $1,200.00, with the time |
| 1:08 | Dashboard → Invoices | The Acme row flips to a **PAID** stamp, Paid rises by $1,200.00, the activity log shows *Paid* |
| 1:20 | Optional | Forward the same message again: the approval prompt now flags **Possible duplicate** |

## How it stays safe and reliable

- **Approval before every Stripe write.** Drafts, sends, reminders and voids all ask. Each
  approval is for that one call: answering "always" never pre-approves a later invoice.
- **Nothing straight from a message.** `obol_draft_from_message` only proposes. The message is
  treated as untrusted data, and instructions inside it ("send now", "pay this other account")
  are reported as warnings, not followed.
- **Unattended runs fail cleanly.** Under cron, Obol blocks every write with a clear message
  instead of relying on an approval mode that might auto-approve. Elsewhere, Hermes's approval
  gate fails closed when nobody can answer.
- **Your override is respected.** If you run Hermes with approvals switched off (YOLO mode or
  `approvals.mode: off`), Hermes approves every escalation automatically, Obol's included. The
  live-key and unattended-run refusals still apply.
- **Test mode by default.** Live keys are refused in the hook and in the Stripe client unless
  `allow_live: true`.
- **No double billing from retries.** Every Stripe write carries an idempotency key that is
  reused when a timeout or 5xx is retried. After a timeout the tool tells the agent to check the
  list before trying again.
- **Validation before the network.** Emails, amounts, quantities, due dates and invoice ids are
  checked before any Stripe call. If adding a line item fails, the half-built draft is deleted.
- **Errors are answers, not crashes.** Every tool returns JSON with a short `kind`
  (`not_configured`, `live_blocked`, `auth`, `not_found`, `invalid_arguments`, `timeout`,
  `llm_unavailable`, …).
- **Pinned Stripe API version** (`2024-06-20`).

### Risk checks

The approval hook runs three checks before you approve a create, send or reminder:

1. **Duplicate:** the same customer, amount and currency invoiced within the window (30 days by default).
2. **Unusual amount:** more than 3× the customer's average invoice, once they have 3 or more invoices.
3. **Contact or payment change:** Stripe recorded a change to the customer's email or payment
   details in the last 14 days, or a client name you've billed before now has a different email.

These are **risk checks, not complete fraud prevention.** They only see Obol's local cache,
this customer's invoices on Stripe, and the last 30 days of Stripe events. If Stripe can't be
reached, the prompt says the checks are incomplete. Read the flags, and confirm changes with
the client through a channel you already trust.

## Sync: polling, not webhooks

Obol does **not** use Stripe webhooks. It never opens a port or receives calls from Stripe.
Payment status is pulled from Stripe when:

- a tool runs (`obol_get_invoice` and `obol_list_invoices` sync first);
- you run `/invoices sync` or `hermes obol sync`;
- the dashboard's Invoices tab is open (it syncs every 45 seconds, and on the *Sync* button).

So a payment shows up the next time one of those happens, not instantly.

## What Obol touches (disclosure)

- **Network: `api.stripe.com` only**, over HTTPS:
  - when an Obol tool, `/invoices sync` or `hermes obol doctor|sync` runs;
  - inside the approval hook before a write, to refresh that customer's invoices and read
    recent `customer.updated` events (5-second timeout, no retries);
  - every 45 seconds while the dashboard's Invoices tab is open.
- **Your model provider:** `obol_draft_from_message` sends the forwarded message to the model
  Hermes is configured to use, through Hermes's own `ctx.llm`. Obol holds no model credentials.
- **Emails to your clients:** sending and reminding make *Stripe* email the customer.
- **Credentials:** reads `STRIPE_API_KEY` through Hermes's secret route only. It never reads
  `.env` or any other credential file itself, and never logs the key.
- **Local data:** `<HERMES_HOME>/plugin-data/obol/data.db` (SQLite) holds:
  - a cache of invoice metadata: number, client name and email, amounts, status, dates, and
    Stripe payment and PDF links;
  - risk-check results per invoice;
  - an activity log of the last 1,000 actions, including one line per forwarded message
    (amount, client and source, not the message text).

  It follows the active Hermes profile and survives plugin updates. Delete the file to clear it.
- **No telemetry, no shell commands, no background processes, no self-updating code.**

## Development

```bash
git clone https://github.com/ueddy/obol && cd obol
python -m pytest                               # unit tests (fake Stripe + recorded responses)
/path/to/hermes-venv/bin/python -m pytest       # adds tests that load the plugin through Hermes
hermes plugins validate . --install-deps && hermes plugins doctor . --ci
```

`tests/test_stripe_live.py` runs the invoice operations end to end against the real Stripe API
(create, send, remind, list, void, delete) whenever a **test** key is set as `STRIPE_API_KEY`
or `STRIPE_SECRET_KEY`. It refuses live keys, uses a fresh `@example.com` customer each run, and
voids or deletes everything it creates (Stripe keeps voided invoices; they can't be deleted).
Without a key it skips. In CI, add a repository secret named `STRIPE_API_KEY` holding an
`sk_test_` key to turn it on.

```bash
STRIPE_API_KEY=sk_test_... python -m pytest tests/test_stripe_live.py -v
```

Re-record the Stripe fixtures against your own test account (test keys only; account names and
invoice links are scrubbed):

```bash
STRIPE_API_KEY=sk_test_... python scripts/record_stripe_fixtures.py
```

Layout:

```text
plugin.yaml             manifest: tools, hook, env, settings form
__init__.py             register(): tools, approval hook, /invoices, CLI, blueprint, skill
schemas.py              tool schemas the model reads
src/obol_lib/
  stripe_client.py      Stripe REST client (httpx, idempotency, retries, pinned API version)
  service.py            invoice operations      money.py    USD/currency handling
  gate.py               approval policy         risk.py     risk checks
  intake.py             forwarded-message extraction      store.py    SQLite cache
dashboard/              manifest.json, plugin_api.py (FastAPI routes), dist/ (plugin-SDK React, no build)
skills/invoicing/       the obol:invoicing skill
tests/                  unit, recorded-response, Stripe test-mode, dashboard-API and Hermes integration tests
scripts/                Stripe fixture recorder
video/                  Remotion source for the demo video (not loaded by Hermes)
```

## License

MIT
