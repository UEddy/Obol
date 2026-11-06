# Obol

[![tests](https://github.com/UEddy/Obol/actions/workflows/tests.yml/badge.svg)](https://github.com/UEddy/Obol/actions/workflows/tests.yml)

**Safe invoicing for [Hermes Agent](https://github.com/NousResearch/hermes-agent).** Forward a client's message,
approve the draft, get paid, all from the chat you already use. Built for freelancers, indie developers, AI
consultants and agencies who bill clients.

> Agents that handle money are a new target for invoice scams. Obol puts an approval in front of every invoice
> Hermes sends, and catches the tricks that hit invoicing: lookalike addresses, impersonated clients, instructions
> hidden in forwarded messages, duplicates and quiet edits to the record. It does not prevent all fraud; the
> [limits](#what-obol-does-not-protect-against) are spelled out below.

```text
Client:  "Loved the new site! Send the invoice: $2,000 build + $400 revisions, due in 14 days."
You:     (forward it to Hermes)
Hermes:  Proposed invoice: Acme Studio · $2,400.00 · due in 14 days        [Allow once] [Deny]
You:     Allow once
Hermes:  Sent. Payment link: https://…
You:     Have they paid?
Hermes:  Yes, paid in full today.
```

**Demo (70 s):** link in the catalog PR · **Install:** `hermes plugins install ueddy/obol`

---

## What it does

| | |
|---|---|
| **Draft from a message** | Forward a client's message from any chat; Hermes extracts who to bill, line items, total and due date with your own model. Nothing is created yet. |
| **Approve every invoice** | Creating, sending, reminding and voiding each ask you first, with the amount, recipient and risk checks in the prompt. "Always" never carries over to the next invoice. |
| **Get paid** | Your client gets a hosted payment link and pays by card. Ask "have they paid?" and Hermes checks. |
| **See everything** | `/invoices` shows paid, open and overdue in any chat; the dashboard adds an Invoices table and a Security view. |
| **Chase overdue** | An optional weekly report of who to chase. It never sends anything on its own. |

## Security

| Check | What happens |
|---|---|
| **Injected instructions** | Forwarded messages are scanned for instructions to the assistant, including hidden (zero-width, invisible, HTML comments), encoded (base64, URL, hex) and non-English ones. A message can never choose who gets paid. |
| **Lookalike addresses** | A recipient domain that imitates one you've billed (`acrnestudio` vs `acmestudio`) is flagged. |
| **Impersonation** | A known client at a domain you've never billed them at is flagged. |
| **Duplicates, odd amounts, changed details** | Same amount recently, far above the client's average, or contact details changed just before billing. |
| **Fraud risk and disputes** | After payment, the provider's fraud-risk rating and any dispute are shown. |
| **Live keys locked** | Live keys are refused unless you turn live mode on. |
| **Scheduled runs blocked** | Unattended (cron) runs can never send an invoice. |
| **Tamper-evident logs** | Activity and security logs are hash-chained; `hermes obol doctor` detects edits. |

Every check is backed by tests; see the [threat model](#threat-model).

## Works anywhere Hermes runs

| Surface | Approval | `/invoices` |
|---|---|---|
| **Telegram** | buttons | ✓ |
| **WhatsApp** | buttons (Cloud API) or typed `/approve` | ✓ |
| **Slack** | buttons | ✓ (also `/hermes invoices`) |
| **Email** | typed `/approve` | ✓ |
| **Terminal** | approval panel | ✓ |

`tests/test_gateways.py` drives each surface through Hermes's real gateway code: tools enabled, approval asked in
that chat (deny sends nothing, approve sends), and `/invoices` dispatched. Telegram was also run live end to end
with a real bot for the demo.

## Payment providers

| Provider | Status |
|---|---|
| Stripe | Supported |
| Bank transfer with PDF invoices | Supported: no provider account, no network |
| PayPal, Paystack, Flutterwave | Planned |

The approvals, scam checks and logs sit in front of the provider and don't depend on it.

**Bank-transfer mode.** Set `provider: bank_transfer` and your bank details. Obol keeps the invoices itself:
approving an invoice issues it with a number (`INV-0001`), a due date and a PDF carrying your bank details and the
invoice number as the payment reference. You send the PDF yourself; when the money lands, say so and Obol records
it with `obol_mark_paid` (approved like every other write). Every check, `/invoices` and the dashboard work the
same, and if your own payout details change, the next invoice's approval says so.

## Quick start

1. Get a **test** secret key (`sk_test_…`) from a free Stripe account in test mode.
2. Install and check:

   ```bash
   hermes plugins install ueddy/obol     # asks for STRIPE_API_KEY
   hermes plugins enable obol
   hermes obol doctor                    # key mode, provider reachable, log integrity
   ```

3. Fill the test account with sample clients (about 40 seconds; test keys only, re-run anytime):

   ```bash
   hermes obol demo
   ```

   It creates paid, open and overdue invoices with real past dates and prints four things to try: forward a client's
   message, "have they paid?", a lookalike-address scam, and paying with test card `4242 4242 4242 4242`.

No Stripe account? Use bank-transfer mode instead (see [Configure](#configure)); `hermes obol doctor` then
checks your bank details.

Requires Hermes Agent 0.22+. No extra Python dependencies.

## For judges

| Check | How |
|---|---|
| Try it in two minutes | `hermes obol demo` with a Stripe test key: sample clients, then four prompts to try |
| Installs cleanly | `hermes plugins validate . --install-deps && hermes plugins doctor . --ci` → 8 tools, 1 hook, install scan **safe** |
| Tests | `python -m pytest`: 227 tests, no keys needed (unit, adversarial, recorded real responses, gateway, Hermes integration) |
| Claims are proven | `tests/test_readme_claims.py` fails if any test named in this README doesn't exist |
| Real, not mocked | live test-mode suite (`tests/test_stripe_live.py`), real-model intake suite (`tests/test_intake_live.py`), recorded real responses, live Telegram run |
| More than a skill | tools, an approval hook, structured extraction via `ctx.llm`, dashboard tab + API, slash command, CLI, automation blueprint, skill |

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
| T20 | **Your own payout details swapped** (someone edits your bank account in Obol's settings so clients pay them) | In bank-transfer mode, a change to your payout details is flagged HIGH in the next invoice's approval with the new account's last four digits; only a fingerprint is logged, never the number. Marking paid is a write that needs approval and is refused in scheduled runs | `tests/test_bank.py::test_changed_payout_details_are_flagged_on_the_next_invoice`, `tests/test_bank.py::test_approval_prompt_says_bank_transfer` |

**No noise in normal use.** The checks stay quiet on everyday client messages ("send the invoice to
ap@…", "please ignore my previous email, the amount is $500", "invoice us right away") and on the
demo's own client list: `tests/test_security.py::test_normal_messages_raise_nothing`,
`tests/test_security.py::test_no_false_positives_across_demo_clients`,
`tests/test_security.py::test_unrelated_domains_are_quiet`,
`tests/test_payment_risk.py::test_normal_payment_records_radar_level_without_noise`.

### What Obol does not protect against

- **You approving something you shouldn't.** Obol shows the facts and flags; the decision is yours.
- **Approvals switched off.** With YOLO mode or `approvals.mode: off`, Hermes approves everything, Obol's prompts included. Live-key and scheduled-run refusals still apply.
- **Injection it has never seen.** Detection is pattern-based; new phrasings, other languages or instructions in images can slip through. The recipient rule and the approval prompt don't depend on detection.
- **Lookalikes of clients you haven't billed yet.** Comparisons use Obol's local history only.
- **Someone impersonating *you* to your client.** An invoice sent outside Obol never reaches it.
- **A compromised provider account or key.**
- **An attacker who can rewrite the whole database.** The chain catches edits that don't recompute it; `hermes obol doctor` prints the head hash so you can keep a copy elsewhere.
- **Real-time alerts.** Obol polls (no webhooks), so payments and disputes appear on the next sync.

## Configure

Settings live under `plugins.entries.obol.settings` (Hermes Desktop shows them as a form).

| Setting | Default | Meaning |
|---|---|---|
| `allow_live` | `false` | Must be `true` before a live key is accepted |
| `default_currency` | `usd` | Currency when a request doesn't name one |
| `default_days_until_due` | `14` | Payment terms for new invoices |
| `risk_duplicate_window_days` | `30` | Same customer and amount within this many days (`0` = off) |
| `risk_amount_multiplier` | `3.0` | Flag amounts above this multiple of the client's average (`0` = off) |
| `risk_amount_min_history` | `3` | Invoices needed before the amount check applies |
| `risk_contact_change_days` | `14` | Contact details changed this recently (max 30, `0` = off) |
| `risk_lookalike_domains` | `true` | Flag domains that imitate one you've billed |
| `risk_impersonation` | `true` | Flag a known client at a new domain |
| `provider` | `stripe` | `bank_transfer` for PDF invoices paid by bank transfer (no provider account) |
| `business_name` | | Shown at the top of bank-transfer PDFs |
| `bank_account_name`, `bank_account_number` | | Required in bank-transfer mode |
| `bank_name`, `bank_routing` | | Optional: bank, and routing / sort code / IBAN / SWIFT |

Injection detection is always on.

## What Obol touches

- **Network:** the payment provider's API only (today `api.stripe.com`), over HTTPS: when a tool, `/invoices sync` or `hermes obol doctor|sync` runs; in the approval hook before a write (5-second timeout); during sync for fraud-risk and dispute reads (read-only); every 45 s while the dashboard tab is open. Polling only; no webhooks, no open ports. In bank-transfer mode Obol makes no network calls at all.
- **Your model:** `obol_draft_from_message` sends the forwarded message to the model Hermes is configured to use, through `ctx.llm`.
- **Emails:** sending and reminding make the payment provider email your client. In bank-transfer mode nobody is emailed; PDFs are written to `<HERMES_HOME>/plugin-data/obol/invoices/`.
- **Credentials:** `STRIPE_API_KEY`, read only through Hermes's secret route; never logged or stored.
- **Local data:** `<HERMES_HOME>/plugin-data/obol/data.db`: cached invoice metadata, risk findings, and hash-chained activity and security logs (forwarded message text is not stored). Delete the file to clear it.
- **No telemetry, shell commands, background processes or self-updating code.**

## Development

```bash
git clone https://github.com/UEddy/Obol && cd Obol
python -m pytest                              # no keys needed
/path/to/hermes-venv/bin/python -m pytest      # also runs Hermes integration and gateway tests
```

- `STRIPE_API_KEY=sk_test_…` also runs `tests/test_stripe_live.py` (refuses live keys, cleans up after itself).
- `OBOL_LIVE_LLM=1 OBOL_LIVE_HERMES_HOME=…` runs `tests/test_intake_live.py` against a real model and records the results for `tests/test_intake_recorded.py`.
- `demo/` holds everything that regenerates the demo video: capture scripts, VHS tapes, the voiceover builder and the Remotion project.

```text
__init__.py       registration: tools, approval hook, /invoices, CLI, blueprint, skill
schemas.py        tool schemas
src/obol_lib/     provider client, invoice service, approval policy, risk checks,
                  injection + lookalike detection, message intake, SQLite store with hash-chained logs
dashboard/        Invoices and Security views (plugin SDK, no build step) and their API
skills/invoicing/ the obol:invoicing skill
tests/            227 tests
demo/             demo video sources
```

## Roadmap

- PayPal, Paystack and Flutterwave, with the same approvals and checks.
- Reading bank-transfer payments from a bank feed instead of marking them paid by hand.

## License

MIT
