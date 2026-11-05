# Telegram footage (live)

Recorded against the real Telegram Bot API through Hermes's own Telegram gateway, with Obol enabled.

1. Create a bot with BotFather and put its token in the environment as `TELEGRAM_BOT_TOKEN` (never in the repo).
2. Run the gateway on the demo Hermes home: `HERMES_HOME=$OBOL_DEMO_HOME hermes gateway run`.
3. Log Telegram Web into a throwaway profile **outside the repo**:
   `node login.js /tmp/tg-profile /tmp/qr.png` writes the current QR code to `/tmp/qr.png` until you scan it
   (Telegram › Settings › Devices › Link Desktop Device; it rotates about every 30 s).
4. `node chat.js /tmp/tg-profile <bot> send /start` returns Hermes's pairing code; approve it with
   `hermes pairing approve telegram <code>`.
5. Start `python ../pay_when_sent.py billing@acmestudio.example.com ../out &` (it pays the invoice on Stripe's
   page once Hermes sends it), then record: `node chat.js /tmp/tg-profile <bot> record send_and_paid.json ../out`.
6. Delete the profile (`rm -rf /tmp/tg-profile`), end the web session in Telegram › Settings › Devices, and
   revoke the bot token in BotFather if it was ever shared.
