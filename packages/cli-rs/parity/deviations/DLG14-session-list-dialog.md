# DLG14: no session list dialog yet

TypeScript: `session.list` (`<leader>l`, Ctrl+X L) opens the "Sessions" dialog over the home: a search
field, sessions grouped by day, and the hints "delete ctrl+d", "rename ctrl+r", and "all projects ctrl+a".
Enter opens the selected session.

Rust: `session.list` is not registered, so Ctrl+X L does nothing and the T.1 home stays on screen. In
P-APP `H.2/home-sessions`, checkpoint `list` differs in every cell. Enter then opens the session selected in
the home list, which is the same session the TS dialog opens, so the next checkpoint reaches the session view
on both sides.

Reason: not built yet. E.11a adds the dialog, then removes this file and the `deviation` entry of that
checkpoint.
