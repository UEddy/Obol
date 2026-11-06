# Paper-desk demo, scene 9: hermes obol doctor on a COPY of the demo log with one entry edited (paper_terminal.sh).
Output out/paper_doctor.gif
Source tapes/_style.tape
Set FontSize 29
Set Width 1840
Set Height 560
Hide
Type "cd $HERMES_HOME && export PS1='$ ' && clear"
Enter
Sleep 1s
Show
Type "hermes obol doctor"
Enter
Wait+Screen /TAMPERED/
Sleep 4s
Screenshot out/paper_doctor.png
