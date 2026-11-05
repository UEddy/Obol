# Scene 3 (end): back in the same Hermes session after the client has paid on Stripe's page, "Have they paid?".
Output out/have_they_paid.mp4
Source tapes/_phone.tape

Hide
Type "cd /tmp/obol-demo && clear && hermes chat --continue"
Enter
Wait+Screen /(?i)(welcome to hermes|resum)/
Sleep 2s
Ctrl+L
Sleep 1s
Show

Type "Have they paid?"
Sleep 500ms
Enter
Wait+Screen /(?i)(\byes\b|paid (on|in full|today)|was paid|have paid|has been paid)/
Sleep 7s
