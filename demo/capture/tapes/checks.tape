# Scenes 8-9: a live key refused (live mode is off), and hermes obol doctor catching an edited log entry.
# No model calls. Run via capture.sh after the dashboard is filmed: it really edits the demo home's log.
Output out/checks.mp4
Source tapes/_phone.tape

Hide
Type "cd $HERMES_HOME && export PS1='$ ' && clear"
Enter
Sleep 1s
Show

Type "STRIPE_API_KEY=sk_live_demo hermes obol doctor"
Sleep 400ms
Enter
Wait+Screen /LIVE key/
Sleep 3s
Type "clear"
Enter
Sleep 300ms
Type `sqlite3 plugin-data/obol/data.db "UPDATE events SET detail='paid in full' WHERE seq=5"`
Sleep 400ms
Enter
Sleep 800ms
Type "hermes obol doctor"
Sleep 400ms
Enter
Wait+Screen /TAMPERED/
Sleep 3s
