# Obol demo: narration and captions

One voice, speaking to the viewer, conversational and confident. 148 words over 85 seconds
(about 1.7 words per second, with room to breathe). Captions are the narration, word for word,
split into the caption cards shown below (`/` marks a card break). The same text drives the
Remotion captions from `narration.json`, so change both together.

## Recording notes for ElevenLabs

- One file per beat, named `beat1.mp3` … `beat8.mp3`, into `demo/remotion/public/audio/`. The video
  times each scene to its file's length (within the beat's maximum below), so re-recording one beat
  never shifts the others.
- Voice: warm, mid-range, unhurried, natural American or neutral English. Avoid announcer or "trailer" voices.
- Settings to start from: Stability 0.45, Similarity 0.75, Style 0.15, Speaker boost on, speed 1.0.
  Lower stability (0.35) if it sounds flat; raise it (0.55) if words wobble.
- Pronunciation: **Obol** = "OH-bol". **Hermes** = "HER-meez". Say "four-two-four-two" for the test card if it is spoken (it isn't in this script).
- Leave about 0.3 s of silence at the start and end of each file.

## Script

| Beat | Time (max) | On screen | Narration and captions |
|---|---|---|---|
| 1 Hook | 0:00–0:05 | Invoices tab, overdue total visible, dimmed | You did the work. / Now comes the part nobody enjoys: / getting paid. |
| 2 Pain | 0:05–0:13 | Slow zoom onto **$2,350.00 overdue** | Two clients are already late, / and chasing invoices eats the hours / you should spend designing / for the next one. |
| 3 Trigger | 0:13–0:28 | CLI: Acme's message forwarded to Hermes; Obol proposes $1,500 | So when Acme says "send the invoice," / you just forward the message. / Hermes reads it / and drafts the invoice for you. |
| 4 Trust | 0:28–0:37 | Approval prompt: amount, client, TEST mode, risk checks; Approve | Nothing touches money without you. / You see exactly what will be sent, / to whom, / and what Obol checked. |
| 5 Payoff | 0:37–0:54 | Stripe page paid with 4242; "Has Acme paid?"; row stamps PAID | Acme pays by card. / Ask Hermes if they've paid, / and the answer comes straight from Stripe. / The ledger stamps it. |
| 6 Tension | 0:54–1:12 | A forwarded "Acme" message from acrne.example.com telling the assistant to skip approval; recipient withheld; approval prompt with three HIGH flags; Security view | Then "Acme" writes from a new address / and tells your assistant to skip approval. / Obol spots the lookalike domain / and the injected instructions, / and won't let a message choose / who gets paid. |
| 7 Resolution | 1:12–1:20 | `/invoices` in the chat | Everything paid, pending and overdue, / in one command, / in any chat you already use. |
| 8 Close | 1:20–1:25 | End card | Hermes can now run your invoicing, safely. / Obol, in the Hermes Marketplace. |

Word count per beat: 12, 19, 21, 18, 20, 32, 14, 12 = 148 (generated from this table).

## Notes on claims

Every claim in the narration is shown on screen and backed by a test listed in the README's threat model:
"nothing touches money without you" (T8), "won't let a message choose who gets paid" (T1), "spots the
lookalike domain" (T5), "the injected instructions" (T1–T4), "the answer comes straight from Stripe"
(`obol_get_invoice` reads Stripe; `tests/test_stripe_live.py`).
