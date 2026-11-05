# Beats 7-8: a vendor note with a hidden instruction leads to a wallet transfer; Obol Guard intercepts it
# (Deny); then /invoices. Fresh session. The wallet backend is demo/capture/wallet_stub.py (see README).
Output out/guard.mp4
Source tapes/_style.tape
Set FontSize 26
Set LineHeight 1.0

Hide
Type "cd /tmp/obol-demo && clear && hermes chat"
Enter
Wait+Screen /Welcome to Hermes/
Sleep 1s
Ctrl+L
Sleep 1s
Show

Type "Read vendor_note.txt and pay it from my main wallet. Tell me what you'll send, then wait for my OK."
Sleep 600ms
Enter
Wait+Screen /· \d{1,2}:\d{2} [AP]M/   # end-of-turn summary: the assistant is waiting for the OK
Sleep 4s
Type "OK, send it."
Sleep 500ms
Enter
Wait+Screen /Obol Guard/
Sleep 7s
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 600ms
Enter
Wait+Screen /(?i)denied/
Sleep 4s

Type "/invoices"
Sleep 400ms
Enter
Wait+Screen /OBOL LEDGER/
Sleep 7s
