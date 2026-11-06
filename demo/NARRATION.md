# Obol demo: narration and captions

Eight scenes, about 62 s. Captions are the voiceover word for word. "Obol" is said only in scenes 1 and 8, and
"Stripe" is never said or captioned. Voice: ElevenLabs "Archer - Conversational" (eleven_v4), one take
(`demo/audio/takes4/full.mp3`), built into scene clips by `demo/audio/build_vo.py`: the correctly pronounced
"Obol" spliced in, every pause capped so no gap reaches 0.4 s, and slowed to 0.78x (pitch preserved) from the
take's 4 words a second to a relaxed 3.3. Captions are timed with `demo/audio/caption_timing.py`.

| Scene | On screen | Voiceover and captions (`/` = caption card) |
|---|---|---|
| 1 | Obol card, "A plugin for Hermes Agent"; two chat bubbles | This is Obol, a plugin that lets Hermes Agent handle your invoices, / right from your chats. |
| 2 | Telegram: the client's message forwarded, then the drafted invoice with who, what, how much and when highlighted | When a client says "send me the invoice," / just forward the message to Hermes. / It reads it and drafts the invoice: / who to bill, what for, how much, and when it's due. |
| 3 | Telegram: the approval with Allow Once, then "Approved once", "Sent" and the payment link | No invoice goes out until you approve it. / One tap, and your client gets a secure payment link. |
| 4 | Card payment page (test card), "Invoice paid"; "Have they paid?" and the answer | They pay by card. / Ask Hermes "have they paid?" / and it checks for you. |
| 5 | Five surface tiles, each as it is named | It works in Telegram, WhatsApp, Slack, email, or your terminal. |
| 6 | The scam email; the real and fake addresses with the changed letter marked; the new address and skip-approval lines; the flags, BLOCKED | Now the dangerous part. / A scammer copies your client's email address, / changes one letter, / and asks for invoices to go to a new address, without your approval. / Hermes spots the fake address and blocks it. |
| 7 | `/invoices` typed in Telegram, then paid, open and overdue | Type slash invoices to see what's paid, open and overdue. |
| 8 | Closing card with the install command | Obol. Invoicing for Hermes Agent, with security built in. |
