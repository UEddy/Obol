# Beats 3-4: a client message is forwarded to Hermes; Obol drafts the invoice; the approval prompt; Allow once.
# Run from demo/capture via capture.sh (it exports HERMES_HOME and the keys; none appear in this file).
Output out/trigger.mp4
Source tapes/_style.tape

Hide
Type "cd /tmp/obol-demo && clear && hermes chat"
Enter
Wait+Screen /Welcome to Hermes/
Sleep 1s
Ctrl+L
Sleep 1s
Show

Type `Forwarding a WhatsApp from a client: "Loved the support agent! Send the invoice: $1,200 for the build plus $300 for revisions, due in 14 days. Bill billing@pinemoor.example.com. Dana, Pinemoor Labs"`
Sleep 700ms
Enter
Wait+Screen /\$1,500\.00/
Sleep 5s

Type "Looks right, send it."
Sleep 600ms
Enter
Wait+Screen /Allow once/
Sleep 4s
Enter
Wait+Screen /(?i)(payment link|invoice\.stripe\.com|pay\.stripe\.com)/
Sleep 6s
