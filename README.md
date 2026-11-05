# Obol

**Security-first Stripe invoicing for [Hermes Agent](https://github.com/NousResearch/hermes-agent), for builders who bill clients:**
indie developers, AI consultants and agencies building agents for clients.

> Obol protects the money path against the attacks that actually hit invoicing: prompt injection in
> forwarded messages, lookalike and impersonated clients, double billing, an agent acting without consent,
> and quiet edits to the record. It does not prevent all fraud, and this README says exactly what it doesn't cover.

You ship the build; the client says "send the invoice". Forward their message and Hermes drafts it. Obol checks it, you approve it, and Stripe
emails your client a payment link. Ask *"has Acme Studio paid?"* and Hermes checks Stripe. The **Invoices**
tab shows what's outstanding, overdue and paid; the **Security** tab shows every threat Obol flagged,
withheld or blocked, each linked to its invoice. Every security claim below names the test that proves it.

---

## For judges: a 60-second tour

| You want to check… | Do this | Where to look |
|---|---|---|
| It installs and validates | `hermes plugins validate . --install-deps && hermes plugins doctor . --ci` | 7 tools, 1 hook, install scan **safe** |
| The test suite | `python -m pytest` (add a Stripe **test** key to also run the live Stripe tests) | [`tests/`](tests) |
| Every security claim has a test | `python -m pytest tests/test_readme_claims.py` | The [threat model](#threat-model) table below |
| It's real, not mocked | `tests/test_stripe_live.py` runs against Stripe test mode; `tests/fixtures/stripe/flow.json` is a scrubbed recording of real Stripe responses replayed by `tests/test_recorded_responses.py` | |
| It goes beyond a prompt or a skill | See [Hermes surfaces used](#hermes-surfaces-used): 7 tools, a `pre_tool_call` approval hook, `ctx.llm` structured extraction, a dashboard tab with its own API, a slash command, a CLI, an automation blueprint and a skill | |
| The demo | 90-second video (link in the catalog PR); the script is [below](#90-second-demo) | `demo/` regenerates it |

### How Obol maps to the judging criteria

| Criterion | Evidence |
|---|---|
| **Usefulness** | Developers, AI consultants and agencies invoice from the chat they already work in: forward the client's "send the invoice" message, approve, get paid. Overdue chasing, payment status and a receivables ledger come with it. |
| **Reliability** | Idempotent Stripe writes with bounded retries, a pinned Stripe API version, validation before any network call, half-built drafts cleaned up, errors returned as JSON, and tests against a Stripe fake, recorded real responses and live Stripe test mode. |
| **Polish** | Approval prompts that say exactly what will happen and why it might be risky; a dashboard with a TEST MODE badge, stamps that flip to PAID, a Security tab; `/invoices` on every chat surface; `hermes obol doctor`. |
| **Creativity** | Agents that move money are a new attack surface. Obol treats forwarded messages as untrusted input, detects injected instructions in plain, hidden, multilingual and encoded forms, checks recipients against lookalikes of your real clients, and hash-chains its own log. |

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
checks that the `obol` toolset is enabled on that platform; that a Stripe write called from a session on that
platform goes through Hermes's real tool dispatch and asks for approval in that chat through the gateway's
pending-approval path (deny sends nothing, approve sends the invoice); that the platform's approval card or
typed fallback carries Obol's summary; and that `/invoices` typed there is dispatched to Obol.

---

## Hermes surfaces used

| Surface | What Obol registers |
|---|---|
| **Tools** (`ctx.register_tool`) | `obol_create_invoice`, `obol_send_invoice`, `obol_get_invoice`, `obol_list_invoices`, `obol_send_reminder`, `obol_void_invoice`, `obol_draft_from_message` |
| **Hooks** | `pre_tool_call` escalates **every** Stripe write to Hermes's approval prompt with amount, client, mode and risk findings, and refuses live keys and unattended (cron) writes. Other plugins' tools are left alone |
| **Plugin LLM** (`ctx.llm.complete_structured`) | Extracts client, amounts, line items and due date from a forwarded message, using your Hermes model and credentials |
| **Dashboard** (`dashboard/`) | *Invoices* tab (totals, ledger table, status stamps, Radar and risk columns) and *Security* view (threats by type and over time, log integrity, links to invoices), served from a local cache |
| **Slash command** | `/invoices [open\|overdue\|paid\|draft\|sync]` in the terminal and every chat gateway (see [Works anywhere Hermes runs](#works-anywhere-hermes-runs)) |
| **CLI** | `hermes obol doctor` (key mode, Stripe reachable, **log integrity**), `hermes obol sync`, `hermes obol ledger` |
| **Automation blueprint** | *Chase overdue invoices*: a weekly report of who to chase. It never sends anything on its own |
| **Skill** | `obol:invoicing`: how to invoice, handle forwarded messages and treat risk flags |
| **Settings** (`config_schema`) | Live-mode switch, defaults, and every risk check (Desktop renders the form) |

---

## Threat model

Each row is an attack that hits invoicing in practice, how Obol responds, and the tests that prove it.
`tests/test_readme_claims.py` fails if any test named here doesn't exist.

| # | Attack | How Obol defends | Proven by |
|---|---|---|---|
| T1 | **Prompt injection in a forwarded message** (direct: a "note to the assistant" telling it to drop its rules, skip approval and bill billing@attacker.example) | A deterministic detector (no model involved) scans every forwarded message. Instructions are flagged, shown in the reply, carried into the approval prompt and logged. The message can never choose the recipient: Obol withholds an address that came from it unless it's the one already on file for that client. Intake never creates or sends anything. | `tests/test_security.py::test_direct_injection_is_high`, `tests/test_intake.py::test_injected_message_never_picks_the_recipient`, `tests/test_intake.py::test_injection_findings_carry_into_the_approval_prompt`, `tests/test_hermes_integration.py::test_injection_and_lookalike_reach_the_approval_prompt_and_security_log` |
| T2 | **Hidden injection** (zero-width characters, bidi overrides, invisible Unicode tag characters, HTML comments, full-width letters) | Text is normalised (NFKC, invisible characters removed, tag characters decoded) before scanning; hidden text alone is flagged | `tests/test_security.py::test_zero_width_split_words`, `tests/test_security.py::test_unicode_tag_smuggling`, `tests/test_security.py::test_html_comment`, `tests/test_security.py::test_bidi_override_and_fullwidth`, `tests/test_security.py::test_hidden_text_without_instructions_is_medium` |
| T3 | **Multilingual injection** (Spanish, French, German, Portuguese, Italian, Chinese, Japanese, Russian, Arabic) | Patterns for each language | `tests/test_security.py::test_multilingual_injection` |
| T4 | **Encoded injection** (base64, URL-encoding, hex escapes) | Encoded blobs are decoded and scanned too | `tests/test_security.py::test_base64_payload`, `tests/test_security.py::test_url_encoded_payload`, `tests/test_security.py::test_hex_escaped_payload` |
| T5 | **Lookalike domain** (pinernoor.example vs pinemoor.example, Cyrillic а, northw1nd, pinemoor.co vs pinemoor.com, pinemoor-billing.com) | The recipient's domain is compared with every domain you've billed: homoglyph skeletons, 1–2 character edits, the same name on another TLD, a known name plus extra words | `tests/test_security.py::test_lookalikes_are_caught`, `tests/test_security.py::test_lookalike_finding_names_the_real_domain` |
| T6 | **Impersonation**: a known client "writes from a new address" | A client name you've billed before, at a domain you've never used for them, is flagged (a new mailbox at their usual domain isn't) | `tests/test_risk.py::test_same_name_new_email`, `tests/test_intake.py::test_changed_email_for_known_client_warns` |
| T7 | **Account takeover / BEC**: the client's email or payment details changed in Stripe just before you bill | Recent `customer.updated` events touching email or payment details are flagged | `tests/test_risk.py::test_stripe_customer_updated_event`, `tests/test_risk.py::test_old_or_irrelevant_events_ignored` |
| T8 | **Agent acting without consent** (a fooled or overeager model creating, sending, reminding or voiding) | Every Stripe write goes through Hermes's approval prompt, drafts included; there's no setting to turn it off | `tests/test_gate.py::test_every_write_asks_including_drafts`, `tests/test_hermes_integration.py::test_approval_gate_directives` |
| T9 | **One "always" approval reused for later invoices** | Every approval has its own rule key, so "always" can't carry over | `tests/test_gate.py::test_rule_key_is_unique_per_call` |
| T10 | **Unattended runs auto-approving writes** (cron with `approvals.cron_mode`) | Obol blocks every write during cron, and fails closed if it can't tell | `tests/test_gate.py::test_unattended_runs_are_blocked_cleanly`, `tests/test_hermes_integration.py::test_cron_detection_fails_closed` |
| T11 | **Live key used by mistake** | Live keys are refused in the hook and in the Stripe client unless `allow_live: true` | `tests/test_gate.py::test_live_key_blocked_unless_allowed`, `tests/test_stripe_client.py::test_client_refuses_bad_keys`, `tests/test_hermes_integration.py::test_live_key_blocked_by_hook` |
| T12 | **Double billing** (a duplicate invoice, or a retry after a timeout) | Duplicate check in the approval prompt; every Stripe write carries an idempotency key reused across retries | `tests/test_risk.py::test_duplicate_within_window`, `tests/test_stripe_client.py::test_retries_5xx_with_same_idempotency_key`, `tests/test_risk.py::test_sees_invoices_made_outside_obol` |
| T13 | **Inflated or fat-fingered amount** | Flags amounts far above the client's average | `tests/test_risk.py::test_unusual_amount_needs_history` |
| T14 | **Risky or disputed payment** | Stripe Radar's risk level and any dispute on paid invoices are read (GET only) and surfaced; disputes are rechecked for 120 days | `tests/test_payment_risk.py::test_elevated_radar_risk_is_flagged`, `tests/test_payment_risk.py::test_dispute_found_on_a_later_sync_once`, `tests/test_payment_risk.py::test_payment_checks_are_read_only` |
| T15 | **Quiet edits to the record** (rewriting who an invoice was sent to, deleting an entry) | Activity and security logs are hash-chained; `hermes obol doctor` and the Security tab verify the chain and detect edits, deletions, reordering and truncation | `tests/test_activity_log.py::test_edited_entry_is_detected`, `tests/test_activity_log.py::test_deleted_middle_entry_is_detected`, `tests/test_activity_log.py::test_truncated_tail_is_detected`, `tests/test_hermes_integration.py::test_doctor_reports_intact_then_tampered_log` |
| T16 | **Key leakage through errors or output** | Obol reads `STRIPE_API_KEY` only via Hermes's secret route; anything key-shaped is scrubbed from Stripe error messages | `tests/test_stripe_client.py::test_key_never_appears_in_errors_or_reprs` |
| T17 | **A broken check silently hiding the prompt** | A failing risk check still shows the approval prompt, marked incomplete; a failing hook blocks the call | `tests/test_gate.py::test_flags_shown_and_broken_checks_do_not_hide_prompt`, `tests/test_risk.py::test_stripe_failures_degrade_to_info` |
| T19 | **Obol reaching beyond invoicing** | Obol's only hook gates its own Stripe writes; other plugins' tools pass through untouched, and it registers no observers | `tests/test_hermes_integration.py::test_other_plugins_tools_are_left_alone` |
| T18 | **Hostile input** (malformed invoice ids, path tricks, bad amounts) | Validated locally before any Stripe call | `tests/test_service.py::test_bad_invoice_id_rejected_locally`, `tests/test_service.py::test_validation_happens_before_any_call` |

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
- **A compromised Stripe account or key.** Whoever holds the key can use Stripe directly.
- **An attacker who can rewrite the whole database.** The hash chain catches edits by anything that doesn't recompute the chain; someone with full write access can rebuild it. `hermes obol doctor` prints the head hash so you can record it somewhere else.
- **Real-time alerts.** Obol polls Stripe (no webhooks), so a payment or dispute shows up on the next sync.
- **Card fraud in general.** Obol shows Stripe Radar's verdict; it doesn't add its own fraud scoring.

---

## Set up (Stripe test mode)

1. Create a free Stripe account; test mode needs no activation.
2. In Stripe, switch on **Test mode** and copy the secret key from
   <https://dashboard.stripe.com/test/apikeys> (`sk_test_…`). A restricted key (`rk_test_…`) works if it can
   write Customers, Invoices and Invoice Items and read Events, Charges and Disputes.
3. Install, enable and check:

   ```bash
   hermes plugins install ueddy/obol     # asks for STRIPE_API_KEY
   hermes plugins enable obol
   hermes obol doctor                    # key mode, Stripe reachable, log integrity
   ```

4. Restart `hermes dashboard` to see **Invoices** (with the Security view).

To pay a test invoice, open its payment link and use Stripe's test card **4242 4242 4242 4242**, any future
expiry, any CVC and any postcode. No real money moves in test mode. Stripe applies its own test-mode rules
to invoice emails, so in a demo open the link Hermes returns.

Requires Hermes Agent 0.22 or newer. No new Python dependencies: Obol talks to Stripe's REST API with the
`httpx` that ships with Hermes (not the Stripe SDK).

## Configure

Settings live under `plugins.entries.obol.settings` in `config.yaml`; Hermes Desktop shows them as a form.

| Setting | Default | Meaning |
|---|---|---|
| `allow_live` | `false` | Must be `true` before a `sk_live_` / `rk_live_` key is accepted |
| `default_currency` | `usd` | Currency when a request doesn't name one |
| `default_days_until_due` | `14` | Payment terms for new invoices |
| `risk_duplicate_window_days` | `30` | Same customer and amount within this many days. `0` turns it off |
| `risk_amount_multiplier` | `3.0` | Amount above this multiple of the customer's average. `0` turns it off |
| `risk_amount_min_history` | `3` | Invoices a customer needs before the unusual-amount check applies |
| `risk_contact_change_days` | `14` | Email or payment details changed in Stripe this recently (max 30). `0` turns it off |
| `risk_lookalike_domains` | `true` | Flag domains that imitate one you've billed |
| `risk_impersonation` | `true` | Flag a known client name at a domain never used for them |

Prompt-injection detection is always on. The key is `STRIPE_API_KEY`; Hermes stores it in its `.env`, and
Obol reads it only through Hermes's secret route and never logs or stores it.

## 90-second demo

The demo follows one freelancer billing one client (Acme Studio), then one scam attempt. Every shot is the real plugin
against Stripe test mode, driven by a real model (Meta Muse Spark 1.3) in the Hermes CLI. `demo/` holds the seed script, capture scripts,
VHS tapes, narration script and the Remotion project that assemble it.

| Scene | On screen |
|---|---|
| What it is | Obol logo card |
| Send an invoice | A client's forwarded message; Obol drafts $1,800; the approval prompt; approve; sent |
| Get paid | Stripe's hosted page paid with the 4242 test card; "Have they paid?" "Yes — paid." |
| Stop a scam | An email from a lookalike address asks to change where invoices go and to skip approval: Hermes withholds the address, and the approval prompt shows impersonation and lookalike flags; denied |
| See everything | `/invoices` with paid, open and overdue totals |
| Close | Install command |

## How it works

- **Polling, not webhooks.** Obol never opens a port. Payment status comes from Stripe when a tool runs,
  on `/invoices sync` or `hermes obol sync`, and every 45 seconds while the dashboard tab is open. In test
  mode, sync also reads Stripe test clocks so simulated histories show up.
- **Stripe is the source of truth.** The local SQLite cache holds what Stripe last returned; the dashboard
  and `/invoices` read it, so they're fast and work offline.
- **Pinned Stripe API version** `2024-06-20`; idempotency keys on every write; bounded retries on 429/5xx.

## What Obol touches (disclosure)

- **Network: `api.stripe.com` only**, over HTTPS:
  - when an Obol tool, `/invoices sync` or `hermes obol doctor|sync` runs;
  - in the approval hook before a write, to refresh that customer's invoices and read recent `customer.updated` events (5-second timeout, no retries);
  - during sync, to read Radar outcomes and disputes for paid invoices (GET only), and, in test mode, test clocks;
  - every 45 seconds while the dashboard's Invoices tab is open.
- **Your model provider:** `obol_draft_from_message` sends the forwarded message to the model Hermes is
  configured to use, through Hermes's own `ctx.llm`. Obol holds no model credentials.
- **Emails to your clients:** sending and reminding make *Stripe* email the customer.
- **Credentials:** reads `STRIPE_API_KEY` through Hermes's secret route only; never reads `.env` or other
  credential files, never logs the key.
- **Local data:** `<HERMES_HOME>/plugin-data/obol/data.db` (SQLite):
  - invoice metadata cached from Stripe (number, client name and email, amounts, status, dates, payment and PDF links, Radar risk level, dispute status);
  - risk findings per invoice and a hash-chained security log (findings, withheld recipients, blocked writes; up to 5,000 entries);
  - a hash-chained activity log (last 1,000 actions, including one line per forwarded message: amount, client and source, not the message text);
  - short-lived intake findings (6 hours) so the approval prompt can show them.

  It follows the active Hermes profile and survives plugin updates. Delete the file to clear it.
- **No telemetry, no shell commands, no background processes, no self-updating code.**

## Development

```bash
git clone https://github.com/UEddy/Obol && cd Obol
python -m pytest                               # unit, adversarial, recorded-response and dashboard-API tests
/path/to/hermes-venv/bin/python -m pytest       # also loads the plugin through Hermes's real plugin manager
hermes plugins validate . --install-deps && hermes plugins doctor . --ci
```

`tests/test_stripe_live.py` runs create, send, remind, list, void and delete against the real Stripe API
whenever a **test** key is set as `STRIPE_API_KEY` or `STRIPE_SECRET_KEY`. It refuses live keys, uses a fresh
`@example.com` customer, and voids or deletes what it creates (Stripe keeps voided invoices). In CI, add a
repository secret `STRIPE_API_KEY` with an `sk_test_` key to turn it on.

`tests/test_intake_live.py` runs five forwarded messages (clean, messy, missing amount, several line
items, and one that tries to give the assistant orders) through a **real model** via Hermes's `ctx.llm`
when `OBOL_LIVE_LLM=1` and `OBOL_LIVE_HERMES_HOME` point at a Hermes home with a model configured. It
records the model's raw extractions to `tests/fixtures/intake_recorded.json`, which
`tests/test_intake_recorded.py` replays on every run without a key. The recording in the repo comes from
`gemini-3.1-flash-lite`.

Re-record the replay fixture against your own test account (test keys only; account names, invoice links
and card fingerprints are scrubbed): `STRIPE_API_KEY=sk_test_... python scripts/record_stripe_fixtures.py`.

```text
plugin.yaml             manifest: tools, hook, env, settings form
__init__.py             register(): tools, approval hook, /invoices, CLI, blueprint, skill
schemas.py              tool schemas the model reads
src/obol_lib/
  stripe_client.py      Stripe REST client (httpx, idempotency, retries, pinned version, key redaction)
  service.py            invoice operations, sync, Radar/dispute reads
  gate.py               approval policy              risk.py      risk checks
  security.py           injection + lookalike detection
  intake.py             forwarded-message extraction store.py     SQLite cache, hash-chained logs
dashboard/              manifest.json, plugin_api.py (FastAPI routes), dist/ (plugin-SDK React, no build)
skills/invoicing/       the obol:invoicing skill
tests/                  unit, adversarial, recorded-response, Stripe test-mode, dashboard-API, Hermes integration
scripts/                Stripe fixture recorder
demo/                   seed data, capture scripts, VHS tapes, narration, Remotion project
```

## License

MIT
