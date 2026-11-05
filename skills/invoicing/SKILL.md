---
name: invoicing
description: How to invoice clients, check payments and chase overdue invoices with the Obol (Stripe) tools.
---

# Invoicing with Obol

Obol's tools talk to the user's Stripe account. Treat every call that sends something as
real correspondence with the user's client, even in test mode.

## Creating an invoice
1. Get the customer's **exact billing email** from the user. Never guess or construct one.
2. Confirm amounts and currency when the request is ambiguous ("1.2k" -> 1200, "per hour" -> quantity).
   Amounts are in normal units: `1200` means $1,200.00, not cents.
3. Default to a draft (`send` omitted). Only pass `send: true` when the user clearly asked to
   send, email or "bill" the client now.
4. Report back the invoice number, total, due date and, once sent, the payment link.

## "Has X paid?"
Call `obol_get_invoice` with the invoice id, or with `customer_email` when you only know the
client. Status meanings: `draft` (not sent), `open` (sent, unpaid), `overdue` (open and past
due), `paid`, `void` (cancelled).

## Chasing
`obol_list_invoices` with `status: "overdue"` lists what is late. Send at most one
`obol_send_reminder` per invoice per run, and tell the user who was reminded.

## Safety
- Sends, reminders and voids go through the user's approval prompt. If approval is denied,
  stop and say so; do not retry a different way.
- Voiding cannot be undone. Confirm with the user first unless they asked for it explicitly.
- If a tool returns `kind: "timeout"`, check `obol_list_invoices` before trying again so you
  never bill a client twice.
- If the key is missing or live mode is blocked, relay the tool's message; don't work around it.
