"""Tool schemas: what the model reads to decide when and how to call Obol."""

_INVOICE_ID = {"type": "string", "description": "Stripe invoice id, e.g. 'in_1Q2w3E...'. Get it from "
                                                "obol_list_invoices or obol_get_invoice."}

CREATE_INVOICE = {
    "name": "obol_create_invoice",
    "description": (
        "Create a Stripe invoice for a customer (found or created by email). Creates a DRAFT unless "
        "send=true, in which case it is finalized and the customer is emailed a payment link. Use "
        "the exact amounts and email the user gave; never guess an email address. Amounts are in "
        "normal currency units (1200 = $1,200.00), not cents."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "customer_email": {"type": "string", "description": "Customer's billing email."},
            "customer_name": {"type": "string", "description": "Customer or company name (used for new customers)."},
            "line_items": {
                "type": "array", "minItems": 1, "maxItems": 25,
                "description": "What is being billed.",
                "items": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string", "description": "Line description, e.g. 'October consulting'."},
                        "amount": {"type": "number", "description": "Unit price in currency units, e.g. 1200 or 99.5."},
                        "quantity": {"type": "integer", "minimum": 1, "description": "Defaults to 1."},
                    },
                    "required": ["description", "amount"],
                    "additionalProperties": False,
                },
            },
            "currency": {"type": "string", "description": "ISO code like 'usd' or 'eur'. Defaults to the configured currency."},
            "days_until_due": {"type": "integer", "minimum": 0, "maximum": 365, "description": "Defaults to 14."},
            "memo": {"type": "string", "description": "Optional note printed on the invoice."},
            "send": {"type": "boolean", "description": "Finalize and email the payment link now. Defaults to false (draft)."},
        },
        "required": ["customer_email", "line_items"],
        "additionalProperties": False,
    },
}

SEND_INVOICE = {
    "name": "obol_send_invoice",
    "description": "Finalize a draft (if needed) and email the customer its Stripe payment link. Returns the link.",
    "parameters": {"type": "object", "properties": {"invoice_id": _INVOICE_ID},
                   "required": ["invoice_id"], "additionalProperties": False},
}

GET_INVOICE = {
    "name": "obol_get_invoice",
    "description": (
        "Check an invoice's live status on Stripe (draft / open / overdue / paid / void), amounts, "
        "due date and payment link. Pass invoice_id, or customer_email for that customer's latest "
        "invoices. Use this to answer 'has X paid?'."
    ),
    "parameters": {"type": "object", "properties": {
        "invoice_id": _INVOICE_ID,
        "customer_email": {"type": "string", "description": "Look up this customer's most recent invoices."},
    }, "additionalProperties": False},
}

LIST_INVOICES = {
    "name": "obol_list_invoices",
    "description": (
        "List invoices with totals (outstanding, overdue, paid) per currency. Syncs from Stripe first. "
        "Filter by status: draft, open, outstanding, overdue, paid, void, uncollectible."
    ),
    "parameters": {"type": "object", "properties": {
        "status": {"type": "string", "enum": ["draft", "open", "outstanding", "overdue", "paid", "void", "uncollectible"]},
        "customer_email": {"type": "string"},
        "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Defaults to 20."},
    }, "additionalProperties": False},
}

SEND_REMINDER = {
    "name": "obol_send_reminder",
    "description": "Re-send the payment email for an open (unpaid) invoice as a reminder.",
    "parameters": {"type": "object", "properties": {"invoice_id": _INVOICE_ID},
                   "required": ["invoice_id"], "additionalProperties": False},
}

VOID_INVOICE = {
    "name": "obol_void_invoice",
    "description": "Cancel an invoice: voids an open invoice, or deletes a draft. Cannot be undone.",
    "parameters": {"type": "object", "properties": {
        "invoice_id": _INVOICE_ID,
        "reason": {"type": "string", "description": "Why it is being cancelled (kept in Obol's ledger)."},
    }, "required": ["invoice_id"], "additionalProperties": False},
}

DRAFT_FROM_MESSAGE = {
    "name": "obol_draft_from_message",
    "description": (
        "Turn a forwarded client message or conversation excerpt (Telegram, WhatsApp, Slack, email...) into a "
        "PROPOSED invoice: client, email, amounts, line items, currency and due date. Creates nothing in Stripe. "
        "Show the proposal and its warnings to the user, ask for anything missing, then call "
        "obol_create_invoice with the proposal if they confirm (that call asks them to approve)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "message": {"type": "string", "description": "The forwarded text, verbatim. Up to 20,000 characters."},
            "source": {"type": "string", "description": "Where it came from, e.g. 'telegram', 'whatsapp', 'slack', 'email'."},
            "customer_email": {"type": "string", "description": "Billing email if the USER gave it (overrides the message)."},
            "customer_name": {"type": "string", "description": "Client name if the USER gave it (overrides the message)."},
        },
        "required": ["message"],
        "additionalProperties": False,
    },
}

ALL = (CREATE_INVOICE, SEND_INVOICE, GET_INVOICE, LIST_INVOICES, SEND_REMINDER, VOID_INVOICE, DRAFT_FROM_MESSAGE)
