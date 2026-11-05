# Scenes 2-3: a client's message is forwarded; Obol drafts the invoice; the approval prompt; Allow once.
# Then, after demo/capture/pay_when_sent.py has paid it on Stripe's page, "Have they paid?".
# Run from demo/capture via capture.sh, with pay_when_sent.py already running in the background.
Output out/send_and_paid.mp4
Source tapes/_phone.tape

Hide
Type "cd /tmp/obol-demo && clear && hermes chat"
Enter
Wait+Screen /Welcome to Hermes/
Sleep 1s
Ctrl+L
Sleep 1s
Show

Type `Forwarding a WhatsApp from a client: "Loved the new website! Send the invoice: $1,500 for the build plus $300 for revisions, due in 14 days. Bill billing@acmestudio.example.com. Dana, Acme Studio"`
Sleep 700ms
Enter
Wait+Screen /\$1,800\.00/
Sleep 9s

Type "Looks right, send it."
Sleep 600ms
Enter
Wait+Screen /Allow once/
Sleep 5s
Enter
Wait+Screen /(?i)(invoice\.stripe\.com|payment link)/
Sleep 45s

Type "Have they paid?"
Sleep 500ms
Enter
Wait+Screen /(?i)\b(yes|paid in full|has paid|they paid)\b/
Sleep 7s
