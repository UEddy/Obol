# Obol

**Secure invoicing for [Hermes Agent](https://github.com/NousResearch/hermes-agent), for people who bill clients:**
indie developers, AI consultants, freelancers and agencies.

> Agents that handle money are the new target for invoice scams. Obol lets Hermes draft, send and track your
> invoices from any chat, and stops the attacks that actually hit invoicing: injected instructions in forwarded
> messages, lookalike and impersonated clients, double billing, an agent acting without consent, and quiet edits
> to the record. It does not prevent all fraud, and this README says exactly what it doesn't cover.

A client says "send me the invoice". Forward their message to Hermes and it drafts the invoice: who to bill, what
for, how much and when it's due. Nothing goes out until you approve it. Your client gets a secure payment link;
ask *"have they paid?"* and Hermes checks for you. Type `/invoices` for what's paid, open and overdue. Every
security claim below names the test that proves it.

---

## For judges: a 60-second tour

| You want to check… | Do this | Where to look |
|---|---|---|
| It installs and validates | `hermes plugins validate . --install-deps && hermes plugins doctor . --ci` | 7 tools, 1 hook, install scan **safe** |
| The test suite | `python -m pytest` (no keys needed; add a payment-provider **test** key to also run the live tests) | [`tests/`](tests) |
| Every security claim has a test | `python -m pytest tests/test_readme_claims.py` | The [threat model](#threat-model) table below |
| It's real, not mocked | Live tests run against the payment provider's test mode; `tests/fixtures/stripe/flow.json` is a scrubbed recording of real provider responses, replayed by `tests/test_recorded_responses.py`; Telegram was run live end to end | |
| It goes beyond a prompt or a skill | See [Hermes surfaces used](#hermes-surfaces-used): 7 tools, an approval hook, structured extraction through your model, a dashboard tab with its own API, a slash command, a CLI, an automation blueprint and a skill | |
| The demo | A 62-second video (link in the catalog PR); the script is [below](#demo) | `demo/` regenerates it |

### How Obol maps to the judging criteria

| Criterion | Evidence |
|---|---|
| **Usefulness** | Invoice from the chat you already work in: forward the client's message, approve, get paid. Payment status, overdue reports and totals in one command come with it, on Telegram, WhatsApp, Slack, email and the terminal. |
| **Reliability** | Idempotent writes with bounded retries, a pinned provider API version, validation before any network call, half-built drafts cleaned up, errors returned as JSON, and tests against an in-memory fake, recorded real responses, live test mode and Hermes's own gateway code. |
| **Polish** | Approval prompts that say exactly what will happen and why it might be risky; output that fits a phone chat; a dashboard with Invoices and Security views; `hermes obol doctor`. |
| **Creativity** | Obol treats every forwarded message as untrusted input: it detects injected instructions in plain, hidden, multilingual and encoded forms, never lets a message choose who gets paid, checks recipients against lookalikes of your real clients, and hash-chains its own log. |

### Why not just give the agent the payment provider's own tools?

Payment providers' agent toolkits let a model create invoices. They don't decide whether it should. Obol adds
what an agent handling money needs: an approval on every write that can't be skipped or carried over, risk checks
shown inside that prompt, defense against instructions hidden in forwarded messages, lookalike and impersonation
detection against your real client history, refusal of live keys and unattended writes, a tamper-evident log, and
the same commands in every chat Hermes runs in.

---

## Works anywhere Hermes runs

Obol is a Hermes plugin, so it works in every chat Hermes is connected to. Verified for:

| Surface | Tools | Approval prompt | `/invoices` |
|---|---|---|---|
| **Telegram** | ✓ | buttons | ✓ |
| **WhatsApp** | ✓ | buttons (Cloud API) or typed `/approve` (bridge) | ✓ |
| **Slack** | ✓ | buttons | ✓ (also `/hermes invoices`) |
| **Email** | ✓ | typed `/approve` | ✓ (body starts with `/invoices`, no new subject) |
| **Terminal** (CLI/TUI) | ✓ | approval panel | ✓ |

How it's verified: `tests/test_gateways.py` loads Obol through Hermes's plugin manager and, for each surface,
checks that the `obol` toolset is enabled on that platform; that an invoice write from a session on that platform
goes through Hermes's real tool dispatch and asks for approval in that chat (deny sends nothing, approve sends the
invoice); that the platform's approval card or typed fallback carries Obol's summary; and that `/invoices` typed
there reaches Obol. Telegram was also run live end to end for the demo video: a real bot, Hermes's Telegram
gateway and Telegram Web (`demo/capture/telegram/`).

## Payment providers

Obol's invoicing, approvals, risk checks and logs sit in front of a payment provider, which hosts the payment
link and takes the payment.

| Provider | Status |
|---|---|
| **Stripe** | Supported: invoices, hosted payment links, reminders, payment status, Radar risk and disputes |
| **PayPal** | Planned |
| **Paystack, Flutterwave** | Planned |
| **Bank transfer** (a PDF invoice with your bank details) | Planned |

The scam protections don't depend on the provider. Fake "our billing details have changed" emails do the most
damage with bank transfers, where a payment is hard to reverse.

---

## Hermes surfaces used

| Surface | What Obol registers |
|---|---|
| **Tools** (`ctx.register_tool`) | `obol_create_invoice`, `obol_send_invoice`, `obol_get_invoice`, `obol_list_invoices`, `obol_send_reminder`, `obol_void_invoice`, `obol_draft_from_message` |
| **Hook** (`pre_tool_call`) | Escalates **every** invoice write to Hermes's approval prompt with amount, client, mode and risk findings, and refuses live keys and unattended (cron) writes. Other plugins' tools are left alone |
| **Plugin LLM** (`ctx.llm.complete_structured`) | Extracts client, amounts, line items and due date from a forwarded message, using your Hermes model and credentials |
| **Dashboard** (`dashboard/`) | *Invoices* tab (totals, invoice table, status stamps, payment-risk column) and *Security* view (threats by type and over time, log integrity, links to invoices) |
| **Slash command** | `/invoices [open\|overdue\|paid\|draft\|sync]` in the terminal and every chat gateway |
| **CLI** | `hermes obol doctor` (key mode, provider reachable, **log integrity**), `hermes obol sync`, `hermes obol ledger` |
| **Automation blueprint** | *Chase overdue invoices*: a weekly report of who to chase. It never sends anything on its own |
| **Skill** | `obol:invoicing`: how to invoice, handle forwarded messages and treat risk flags |
| **Settings** (`config_schema`) | Live-mode switch, defaults, and every risk check (Hermes Desktop renders the form) |

---

## Threat model

Each row is an attack that hits invoicing in practice, how Obol responds, and the tests that prove it.
`tests/test_readme_claims.py` fails if any test named here doesn't exist.

| # | Attack | How Obol defends | Proven by |
|---|---|---|---|
| T1 | **Prompt injection in a forwarded message** (a "note to the assistant" telling it to drop its rules, skip approval and bill billing@attacker.example) | A deterministic detector (no model involved) scans every forwarded message. Instructions are flagged, shown in the reply, carried into the approval prompt and logged. The message can never choose the recipient: Obol withholds an address that came from it unless it's the one already on file for that client. Drafting never creates or sends anything. | `tests/test_security.py::test_direct_injection_is_high`, `tests/test_intake.py::test_injected_message_never_picks_the_recipient`, `tests/test_intake.py::test_injection_findings_carry_into_the_approval_prompt`, `tests/test_hermes_integration.py::test_injection_and_lookalike_reach_the_approval_prompt_and_security_log` |
| T2 | **Hidden injection** (zero-width characters, bidi overrides, invisible Unicode tag characters, HTML comments, full-width letters) | Text is normalised (NFKC, invisible characters removed, tag characters decoded) before scanning; hidden text alone is flagged | `tests/test_security.py::test_zero_width_split_words`, `tests/test_security.py::test_unicode_tag_smuggling`, `tests/test_security.py::test_html_comment`, `tests/test_security.py::test_bidi_override_and_fullwidth`, `tests/test_security.py::test_hidden_text_without_instructions_is_medium` |
| T3 | **Multilingual injection** (Spanish, French, German, Portuguese, Italian, Chinese, Japanese, Russian, Arabic) | Patterns for each language | `tests/test_security.py::test_multilingual_injection` |
| T4 | **Encoded injection** (base64, URL-encoding, hex escapes) | Encoded blobs are decoded and scanned too | `tests/test_security.py::test_base64_payload`, `tests/test_security.py::test_url_encoded_payload`, `tests/test_security.py::test_hex_escaped_payload` |
| T5 | **Lookalike domain** (acrnestudio vs acmestudio, a Cyrillic а, northw1nd, .co vs .com, a known name plus "-billing") | The recipient's domain is compared with every domain you've billed: homoglyph skeletons, 1–2 character edits, the same name on another TLD, a known name plus extra words | `tests/test_security.py::test_lookalikes_are_caught`, `tests/test_security.py::test_lookalike_finding_names_the_real_domain` |
| T6 | **Impersonation**: a known client "writes from a new address" | A client name you've billed before, at a domain you've never used for them, is flagged (a new mailbox at their usual domain isn't) | `tests/test_risk.py::test_same_name_new_email`, `tests/test_intake.py::test_changed_email_for_known_client_warns` |
| T7 | **Account takeover**: the client's email or payment details changed at the provider just before you bill | Recent changes to the customer's email or payment details are flagged | `tests/test_risk.py::test_stripe_customer_updated_event`, `tests/test_risk.py::test_old_or_irrelevant_events_ignored` |
| T8 | **Agent acting without consent** (a fooled or overeager model creating, sending, reminding or voiding) | Every invoice write goes through Hermes's approval prompt, drafts included; there's no setting to turn it off | `tests/test_gate.py::test_every_write_asks_including_drafts`, `tests/test_hermes_integration.py::test_approval_gate_directives` |
| T9 | **One "always" approval reused for later invoices** | Every approval has its own rule key, so "always" can't carry over | `tests/test_gate.py::test_rule_key_is_unique_per_call` |
| T10 | **Unattended runs auto-approving writes** (cron with `approvals.cron_mode`) | Obol blocks every write during cron, and fails closed if it can't tell | `tests/test_gate.py::test_unattended_runs_are_blocked_cleanly`, `tests/test_hermes_integration.py::test_cron_detection_fails_closed` |
| T11 | **Live key used by mistake** | Live keys are refused in the hook and in the provider client unless `allow_live: true` | `tests/test_gate.py::test_live_key_blocked_unless_allowed`, `tests/test_stripe_client.py::test_client_refuses_bad_keys`, `tests/test_hermes_integration.py::test_live_key_blocked_by_hook` |
| T12 | **Double billing** (a duplicate invoice, or a retry after a timeout) | Duplicate check in the approval prompt; every write carries an idempotency key reused across retries | `tests/test_risk.py::test_duplicate_within_window`, `tests/test_stripe_client.py::test_retries_5xx_with_same_idempotency_key`, `tests/test_risk.py::test_sees_invoices_made_outside_obol` |
| T13 | **Inflated or fat-fingered amount** | Flags amounts far above the client's average | `tests/test_risk.py::test_unusual_amount_needs_history` |
| T14 | **Risky or disputed payment** | The provider's fraud-risk level and any dispute on paid invoices are read (read-only) and surfaced; disputes are rechecked for 120 days | `tests/test_payment_risk.py::test_elevated_radar_risk_is_flagged`, `tests/test_payment_risk.py::test_dispute_found_on_a_later_sync_once`, `tests/test_payment_risk.py::test_payment_checks_are_read_only` |
| T15 | **Quiet edits to the record** (rewriting who an invoice was sent to, deleting an entry) | Activity and security logs are hash-chained; `hermes obol doctor` and the Security view verify the chain and detect edits, deletions, reordering and truncation | `tests/test_activity_log.py::test_edited_entry_is_detected`, `tests/test_activity_log.py::test_deleted_middle_entry_is_detected`, `tests/test_activity_log.py::test_truncated_tail_is_detected`, `tests/test_hermes_integration.py::test_doctor_reports_intact_then_tampered_log` |
| T16 | **Key leakage through errors or output** | Obol reads the provider key only via Hermes's secret route; anything key-shaped is scrubbed from provider error messages | `tests/test_stripe_client.py::test_key_never_appears_in_errors_or_reprs` |
| T17 | **A broken check silently hiding the prompt** | A failing risk check still shows the approval prompt, marked incomplete; a failing hook blocks the call | `tests/test_gate.py::test_flags_shown_and_broken_checks_do_not_hide_prompt`, `tests/test_risk.py::test_stripe_failures_degrade_to_info` |
| T18 | **Hostile input** (malformed invoice ids, path tricks, bad amounts) | Validated locally before any provider call | `tests/test_service.py::test_bad_invoice_id_rejected_locally`, `tests/test_service.py::test_validation_happens_before_any_call` |
| T19 | **Obol reaching beyond invoicing** | Obol's only hook gates its own invoice writes; other plugins' tools pass through untouched, and it registers no observers | `tests/test_hermes_integration.py::test_other_plugins_tools_are_left_alone` |

**No noise in normal use.** The checks stay quiet on everyday client messages ("send the invoice to
ap@…", "please ignore my previous email, the amount is $500", "invoice us right away") and on the
demo's own client list: `tests/test_security.py::test_normal_messages_raise_nothing`,
`tests/test_security.py::test_no_false_positives_across_demo_clients`,
`tests/test_security.py::test_unrelated_domains_are_quiet`,
`tests/test_payment_risk.py::test_normal_payment_records_radar_level_without_noise`.

### What Obol does not protect against

- **You approving something you shouldn't.** Obol puts the facts and flags in front of you; the decision is yours.
- **Approvals switched off.** With YOLO mode or `approvals.mode: off`, Hermes approves every escalation automatically, Obol's included. The live-key and unattended-run refusals still apply.
- **Injection it has never seen.** Detection is pattern-based: new phrasings, other languages, or instructions inside images or attachments can slip through. That's why the recipient rule and the approval prompt don't depend on detection.
- **Lookalikes of clients you haven't billed yet.** The lookalike check compares against domains in Obol's local history only.
- **Someone impersonating *you* to your client.** A fake invoice sent from outside Obol never touches Obol.
- **A compromised payment-provider account or key.** Whoever holds the key can use the provider directly.
- **An attacker who can rewrite the whole database.** The hash chain catches edits by anything that doesn't recompute the chain; someone with full write access can rebuild it. `hermes obol doctor` prints the head hash so you can record it somewhere else.
- **Real-time alerts.** Obol polls the provider (no webhooks), so a payment or dispute shows up on the next sync.
- **Card fraud in general.** Obol shows the provider's fraud-risk verdict; it doesn't add its own fraud scoring.

---

## Set up

Today Obol connects to Stripe. You'll need a free Stripe account in test mode, which needs no activation.

1. Switch on **Test mode** in Stripe and copy the secret key from <https://dashboard.stripe.com/test/apikeys>
   (`sk_test_…`). A restricted key (`rk_test_…`) works if it can write Customers, Invoices and Invoice Items and
   read Events, Charges and Disputes.
2. Install, enable and check:

   ```bash
   hermes plugins install ueddy/obol     # asks for STRIPE_API_KEY
   hermes plugins enable obol
   hermes obol doctor                    # key mode, provider reachable, log integrity
   ```

3. Restart `hermes dashboard` to see **Invoices** (with the Security view).

To pay a test invoice, open its payment link and use the test card **4242 4242 4242 4242**, any future expiry,
any CVC and any postcode. No real money moves in test mode, and test-mode invoices aren't emailed to real
clients, so in a demo open the link Hermes returns.

Requires Hermes Agent 0.22 or newer. No new Python dependencies: Obol uses the `httpx` that ships with Hermes.

## Configure

Settings live under `plugins.entries.obol.settings` in `config.yaml`; Hermes Desktop shows them as a form.

| Setting | Default | Meaning |
|---|---|---|
| `allow_live` | `false` | Must be `true` before a live key (`sk_live_` / `rk_live_`) is accepted |
| `default_currency` | `usd` | Currency when a request doesn't name one |
| `default_days_until_due` | `14` | Payment terms for new invoices |
| `risk_duplicate_window_days` | `30` | Same customer and amount within this many days. `0` turns it off |
| `risk_amount_multiplier` | `3.0` | Amount above this multiple of the customer's average. `0` turns it off |
| `risk_amount_min_history` | `3` | Invoices a customer needs before the unusual-amount check applies |
| `risk_contact_change_days` | `14` | Email or payment details changed at the provider this recently (max 30). `0` turns it off |
| `risk_lookalike_domains` | `true` | Flag domains that imitate one you've billed |
| `risk_impersonation` | `true` | Flag a known client name at a domain never used for them |

Prompt-injection detection is always on. The key is `STRIPE_API_KEY`; Hermes stores it in its `.env`, and Obol
reads it only through Hermes's secret route and never logs or stores it.

## Demo

A 62-second video: one freelancer billing one client (Acme Studio), then one scam attempt. Every shot is real:
Hermes's Telegram gateway driven through Telegram Web, the hosted payment page paid with the test card, and the
Hermes terminal with a real model. `demo/` holds the capture scripts, narration and the Remotion project.

| Scene | On screen |
|---|---|
| What it is | The Obol card |
| Send an invoice | Telegram: a client's message forwarded; Hermes drafts the invoice (who, what for, how much, when) |
| Approve | The approval with **Allow Once**; "Sent" with the payment link |
| Get paid | The payment page paid by card; "Have they paid?" "Yes — paid." |
| Works anywhere | Telegram, WhatsApp, Slack, email and terminal |
| Stop a scam | An email from `acrnestudio` (not `acmestudio`) asks to change where invoices go and to skip approval: the address is withheld, the approval prompt shows impersonation and lookalike flags, and it's blocked |
| See everything | `/invoices`: paid, open and overdue |
| Close | The install command |

## How it works

- **Polling, not webhooks.** Obol never opens a port. Payment status is fetched when a tool runs, on
  `/invoices sync` or `hermes obol sync`, and every 45 seconds while the dashboard tab is open.
- **The provider is the source of truth.** A local SQLite cache holds what the provider last returned; the
  dashboard and `/invoices` read it, so they're fast and work offline.
- **Safe writes:** a pinned provider API version, idempotency keys on every write, bounded retries on 429/5xx.

## What Obol touches (disclosure)

- **Network: the payment provider's API only** (today `api.stripe.com`), over HTTPS:
  - when an Obol tool, `/invoices sync` or `hermes obol doctor|sync` runs;
  - in the approval hook before a write, to refresh that customer's invoices and read recent customer changes (5-second timeout, no retries);
  - during sync, to read fraud-risk outcomes and disputes for paid invoices (read-only), and, in test mode, test clocks;
  - every 45 seconds while the dashboard's Invoices tab is open.
- **Your model provider:** `obol_draft_from_message` sends the forwarded message to the model Hermes is
  configured to use, through Hermes's own `ctx.llm`. Obol holds no model credentials.
- **Emails to your clients:** sending and reminding make the payment provider email the customer.
- **Credentials:** reads `STRIPE_API_KEY` through Hermes's secret route only; never reads `.env` or other
  credential files, never logs the key.
- **Local data:** `<HERMES_HOME>/plugin-data/obol/data.db` (SQLite):
  - invoice metadata cached from the provider (number, client name and email, amounts, status, dates, payment and PDF links, fraud-risk level, dispute status);
  - risk findings per invoice and a hash-chained security log (findings, withheld recipients, blocked writes; up to 5,000 entries);
  - a hash-chained activity log (last 1,000 actions, including one line per forwarded message: amount, client and source, not the message text);
  - short-lived intake findings (6 hours) so the approval prompt can show them.

  It follows the active Hermes profile and survives plugin updates. Delete the file to clear it.
- **No telemetry, no shell commands, no background processes, no self-updating code.**

## Development

```bash
git clone https://github.com/UEddy/Obol && cd Obol
python -m pytest                               # unit, adversarial, recorded-response and dashboard-API tests
/path/to/hermes-venv/bin/python -m pytest       # also loads the plugin through Hermes's real plugin manager and gateways
hermes plugins validate . --install-deps && hermes plugins doctor . --ci
```

`tests/test_stripe_live.py` runs create, send, remind, list, void and delete against the provider's real API
whenever a **test** key is set as `STRIPE_API_KEY` or `STRIPE_SECRET_KEY`. It refuses live keys, uses a fresh
`@example.com` customer, and voids or deletes what it creates. In CI, add a repository secret `STRIPE_API_KEY`
with an `sk_test_` key to turn it on.

`tests/test_intake_live.py` runs five forwarded messages (clean, messy, missing amount, several line items, and
one that tries to give the assistant orders) through a **real model** via Hermes's `ctx.llm` when
`OBOL_LIVE_LLM=1` and `OBOL_LIVE_HERMES_HOME` point at a Hermes home with a model configured. It records the
model's raw extractions to `tests/fixtures/intake_recorded.json`, which `tests/test_intake_recorded.py` replays
on every run without a key.

Re-record the replay fixture against your own test account (test keys only; account names, invoice links and
card fingerprints are scrubbed): `STRIPE_API_KEY=sk_test_... python scripts/record_stripe_fixtures.py`.

```text
plugin.yaml             manifest: tools, hook, env, settings form
__init__.py             register(): tools, approval hook, /invoices, CLI, blueprint, skill
schemas.py              tool schemas the model reads
src/obol_lib/
  stripe_client.py      payment-provider client (httpx, idempotency, retries, pinned version, key redaction)
  service.py            invoice operations, sync, payment-risk and dispute reads
  gate.py               approval policy              risk.py      risk checks
  security.py           injection + lookalike detection
  intake.py             forwarded-message extraction store.py     SQLite cache, hash-chained logs
dashboard/              manifest.json, plugin_api.py (FastAPI routes), dist/ (plugin-SDK React, no build)
skills/invoicing/       the obol:invoicing skill
tests/                  unit, adversarial, recorded-response, live test-mode, gateway, dashboard-API, Hermes integration
scripts/                fixture recorder
demo/                   capture scripts, narration, voiceover builder, Remotion project
```

## Roadmap

- More payment providers: PayPal, Paystack and Flutterwave, and bank transfer with PDF invoices.
- The same approvals, risk checks and logs for every provider.

## License

MIT
