# Paper-desk demo, scene 6 terminal tab: the ledger in a terminal, same totals as the dashboard shot (no model calls).
Output out/paper_ledger.gif
Source tapes/_style.tape
Set FontSize 34
Set Width 1000
Set Height 1950
Hide
Type "cd $HERMES_HOME && export PS1='$ ' && clear"
Enter
Sleep 1s
Show
Type "hermes obol ledger"
Enter
Wait+Screen /last synced/
Sleep 1s
Screenshot out/paper_ledger.png
