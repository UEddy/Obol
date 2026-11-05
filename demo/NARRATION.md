# Obol demo: narration and captions

The protagonist is an indie developer / AI consultant billing a client (Pinemoor) for an agent build.

One voice, speaking to the viewer, conversational and confident. 158 words over 85 seconds
(about 1.9 words per second, with room to breathe). Captions are the narration, word for word,
split into the caption cards shown below (`/` marks a card break). The same text drives the
Remotion captions from `narration.json`, so change both together.

## Recording notes for ElevenLabs

- One file per beat, named `beat1.mp3` … `beat9.mp3`, into `demo/remotion/public/audio/`. The video
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
| 1 Hook | 0:00–0:06 | Invoices tab, overdue total visible, dimmed | You just finished building. / Now comes the part nobody enjoys: / getting paid. |
| 2 Pain | 0:06–0:13 | Slow zoom onto **$3,600.00 overdue** | Two clients are already late, / and chasing invoices eats the hours / you should spend building. |
| 3 Trigger | 0:13–0:26 | CLI: Pinemoor's message about the support agent forwarded to Hermes; Obol proposes $1,500 | So when Pinemoor says "send the invoice," / you just forward the message. / Hermes reads it / and drafts the invoice for you. |
| 4 Trust | 0:26–0:34 | Approval prompt: amount, client, TEST mode, risk checks; Approve | Nothing touches money without you. / You see exactly what will be sent, / to whom, / and what Obol checked. |
| 5 Payoff | 0:34–0:49 | Stripe page paid with 4242; "Has Pinemoor paid?"; row stamps PAID | Pinemoor pays by card. / Ask Hermes if they've paid, / and the answer comes straight from Stripe. / The ledger stamps it. |
| 6 Tension | 0:49–1:05 | A forwarded "Pinemoor" message from pinernoor.example.com telling the assistant to skip approval; recipient withheld; approval prompt with three HIGH flags; Security view | Then "Pinemoor" writes from a new address / and tells your assistant to skip approval. / Obol spots the lookalike domain / and the injected instructions, / and won't let a message choose / who gets paid. |
| 7 Guard | 1:05–1:12 | Obol Guard intercepts a wallet plugin's unusual transfer: approval prompt with its flags; Security view entry | Obol Guard protects every agent / that touches money. / A surprise transfer waits for you. |
| 8 Resolution | 1:12–1:19 | `/invoices` in the chat | Everything paid, pending and overdue, / in one command, / in any chat you already use. |
| 9 Close | 1:19–1:25 | End card | Hermes can now run your invoicing, safely. / Obol, in the Hermes Marketplace. |

Word count per beat: 12, 15, 21, 18, 20, 32, 14, 14, 12 = 158 (generated from this table).

## Notes on claims

Every claim in the narration is shown on screen and backed by a test listed in the README's threat model:
"nothing touches money without you" (T8), "won't let a message choose who gets paid" (T1), "spots the
lookalike domain" (T5), "the injected instructions" (T1–T4), "protects every agent that touches money" (Obol Guard, G1–G4),
"the answer comes straight from Stripe"
(`obol_get_invoice` reads Stripe; `tests/test_stripe_live.py`).
