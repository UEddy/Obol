# Obol demo: narration and captions

Six scenes, one idea each, about 57 s. Captions are the narration word for word; each caption card plays its
own slice of the voiceover when its action is on screen (`demo/remotion/src/Demo.tsx`). The client on screen is
"Acme Studio"; the voiceover only ever says "your client" / "a client".

Voice: ElevenLabs "Brian" (premade), eleven_v3, stability 0.5, similarity 0.75, style 0.15, speaker boost.
Type Obol as "Oh-bol" so it is said OH-bol; check each take with Whisper (`demo/audio/caption_timing.py`).
Takes are in `demo/audio/takes2/sceneN.mp3`, copied to `demo/remotion/public/audio/`.

| Scene | On screen | Narration and captions (`/` = caption card) |
|---|---|---|
| 1 What it is | Obol logo card | Obol lets Hermes send your Stripe invoices, / and stops scams before money moves. |
| 2 Send an invoice | Forwarded message; the drafted $1,800 total; the approval prompt; "Sent." | Forward a client's message. / Obol drafts the invoice. / Nothing is sent until you approve. |
| 3 Get paid | Stripe page paid with the 4242 test card; "Invoice paid"; "Have they paid?" "Yes — paid." | Your client pays. / Hermes tells you. |
| 4 Stop a scam | Email from billing@acrnestudio.example.com asking to skip approval; Hermes refuses and withholds the address; the approval prompt shows impersonation and lookalike; DENIED | A scammer pretends to be your client. / Obol catches it. |
| 5 See everything | `/invoices`: paid, open and overdue totals | Paid, open and overdue, in one command. |
| 6 Close | Logo card with the install command | Obol, a security-first invoicing plugin for Hermes Agent. |

Claims on screen are backed by tests in the README's threat model: approval on every write (T8), injected
instructions never choose the recipient (T1), lookalike domain (T5) and impersonation checks.
