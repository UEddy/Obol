<!-- Draft for the catalog PR to NousResearch/hermes-agent. Title: feat(plugin-catalog): add Obol, safe invoicing for people who bill clients -->

## What does this PR do?

Adds `plugin-catalog/obol.yaml`: **Obol**, an invoicing plugin for freelancers, consultants and agencies who bill
clients. It works from any chat Hermes runs in. Forward a client's message and Hermes drafts the invoice
(structured extraction through `ctx.llm`). You approve it and it goes out, either as a Stripe payment link or as a
bank-transfer PDF invoice that needs no payment provider. Then ask "have they paid?". Obol also adds Invoices and
Security views to the dashboard and `/invoices` to every chat.

Agents that handle money are a new target for invoice scams, so every invoice write goes through Hermes's approval
prompt. The prompt shows the amount, the recipient, the mode and Obol's risk checks:
- prompt injection in the forwarded message (the message can never choose the recipient);
- lookalike and impersonated client addresses;
- duplicates and unusual amounts;
- recently changed client contact details;
- in bank-transfer mode, a change to your own payout bank details.

Live keys are refused unless `allow_live` is set. Writes are refused in unattended runs.

- Repo: https://github.com/UEddy/Obol (pinned at `38811e15ecc07e4fa483c3c9fd121616c16aa1d3`)
- Demo video (70 s, real footage, Stripe test mode and a live Telegram bot): <!-- link to the X post -->
- Threat model with a test behind every row (T1–T20): https://github.com/UEddy/Obol#threat-model

## Related Issue

Nous Research Hermes Plugin Hackathon submission.

## Type of Change

- [x] ✨ New feature (non-breaking change that adds functionality): a new catalog entry

## Changes Made

- `plugin-catalog/obol.yaml`: a new entry.
  - Community tier, `requires_hermes ">=0.22"` (the same floor as in `plugin.yaml`).
  - Capabilities match the plugin's registrations: 8 tools, the `pre_tool_call` hook and `STRIPE_API_KEY`.
  - Four screenshots, pinned to the SHA.

## Disclosure (rule 13)

**Network calls**
- **Stripe mode:** HTTPS to `api.stripe.com` only. Calls happen:
  - when an Obol tool runs, or on `/invoices sync` and `hermes obol doctor|sync`;
  - in the approval hook before a write, to refresh the customer's invoices and recent `customer.updated` events (5-second timeout);
  - during sync, for read-only fraud-risk (Radar) and dispute reads on paid invoices;
  - every 45 s while the dashboard tab is open;
  - in `hermes obol demo`, which creates and deletes test clocks, customers and invoices (test keys only).
- **Bank-transfer mode:** no network calls at all.
- Polling only: no webhooks and no open ports.

**Other services**
- `obol_draft_from_message` sends the forwarded message to the model the user has configured in Hermes, through `ctx.llm`.
- In Stripe mode, Stripe emails the client when an invoice is sent or reminded. Bank-transfer mode emails nobody; the user sends the PDF.

**Credentials**
- `STRIPE_API_KEY` is read only through `agent.secret_scope.get_secret`. It is never stored, logged or shown; anything key-shaped is scrubbed from error messages.
- The bank details for bank-transfer mode are plugin settings in the user's Hermes config, printed on the PDFs they issue. Obol's logs keep only a fingerprint of them (and the last four digits of the account in a payout-change flag).

**Stored data**, all under `<HERMES_HOME>/plugin-data/obol/`:
- `data.db` (SQLite) holds:
  - the cached invoice metadata;
  - risk findings;
  - hash-chained activity and security logs (forwarded message text is not stored);
  - in bank-transfer mode, the customers (name, email) and invoices Obol keeps itself.
- `invoices/*.pdf` holds the bank-transfer invoices.

**Reads outside its own data:** only its own settings, through `ctx.get_config`.

**None of these:** telemetry, shell commands, background processes, subprocesses, self-updating code or observers on other plugins' tools. The only hook gates Obol's own write tools.

**Approvals:** Obol never auto-approves. Under YOLO or `approvals.mode: off`, Hermes approves everything, Obol's prompts included. The live-key and unattended-run refusals still apply.

## How to Test

1. `hermes plugins install ueddy/obol` with a **test** key (`sk_test_…`), then `hermes obol doctor`. The doctor checks the key mode and that the provider is reachable, and verifies both hash-chained logs.
2. `hermes obol demo` seeds the test account with paid, open and overdue invoices and prints four prompts to try:
   - forward a client's message;
   - "have they paid?";
   - a lookalike-address scam;
   - paying with test card `4242 4242 4242 4242`.
3. **Bank-transfer mode with no Stripe account:** set `provider: bank_transfer`, `bank_account_name` and `bank_account_number` under `plugins.entries.obol.settings`. Then:
   - ask Hermes to invoice a client and approve; you get an `INV-0001` PDF;
   - say the client paid, which calls `obol_mark_paid` (also approved);
   - `/invoices` shows the ledger.
4. Plugin checks at the pinned SHA:
   - `hermes plugins validate --install-deps` passes;
   - `hermes plugins doctor --ci` passes (8 tools, 1 hook);
   - the install scanner verdict is `safe` (`tests/test_hermes_integration.py::test_install_scanner_rates_the_repo_safe`).

## Checklist

### Code

- [x] I've read the Contributing Guide and `plugin-catalog/README.md`
- [x] My commit messages follow Conventional Commits
- [x] I searched for existing PRs to make sure this isn't a duplicate
- [x] My PR contains **only** the catalog entry
- [x] The plugin's suite passes in its own CI at the pinned SHA. The CI runs a unit job, and a full job inside Hermes with `validate` and `doctor`: 223 passed, 2 skipped (the live suites skip without keys). It covers adversarial cases, recorded real responses, and the Telegram/WhatsApp/Slack/email gateway paths. There are also live suites against Stripe test mode and a real model.
- [x] Tested on Ubuntu (Hermes from source, Python 3.14), plus a live Telegram run

### Documentation & Housekeeping

- [x] Plugin README: setup, configuration, the threat model, what Obol does not protect against, and what it touches
- [x] N/A for `cli-config.yaml.example`, `CONTRIBUTING.md` / `AGENTS.md` (no core changes)

## Screenshots / Logs

![Invoices](https://raw.githubusercontent.com/UEddy/Obol/38811e15ecc07e4fa483c3c9fd121616c16aa1d3/docs/screenshots/dashboard-invoices.png)
![Security](https://raw.githubusercontent.com/UEddy/Obol/38811e15ecc07e4fa483c3c9fd121616c16aa1d3/docs/screenshots/dashboard-security.png)
![Approval prompt](https://raw.githubusercontent.com/UEddy/Obol/38811e15ecc07e4fa483c3c9fd121616c16aa1d3/docs/screenshots/approval.png)
![Approval prompt flagging a lookalike scam](https://raw.githubusercontent.com/UEddy/Obol/38811e15ecc07e4fa483c3c9fd121616c16aa1d3/docs/screenshots/approval-scam.png)
