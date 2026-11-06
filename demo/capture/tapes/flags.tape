# Scene 7 (end): a $5,000 invoice to a client whose history makes it a duplicate, an unusual amount, and whose
# contact details just changed (seeded by demo/capture/seed_flags.py). The approval prompt shows all three; Deny.
Output out/flags.mp4
Source tapes/_phone.tape

Hide
Type "cd /tmp/obol-demo && clear && hermes chat"
Enter
Wait+Screen /Welcome to Hermes/
Sleep 1s
Ctrl+L
Sleep 1s
Show

Type `Create and send a $5,000 invoice to Kite & Co at billing@kiteco.example.com, one line item "Agent platform build", due in 14 days.`
Sleep 600ms
Enter
Wait+Screen /Allow once/
Sleep 7s
Down
Sleep 250ms
Down
Sleep 250ms
Down
Sleep 600ms
Enter
Wait+Screen /(?i)denied/
Sleep 3s
