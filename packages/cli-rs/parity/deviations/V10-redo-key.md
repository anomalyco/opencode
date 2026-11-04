# V10: the revert banner has no redo key yet

TypeScript: the banner's last line is `<key> or /redo to restore`, with `session.redo`'s shortcut
(`Keymap.useShortcut("session.redo")`, `routes/session/index.tsx:2269,2328`), for example `ctrl+x r or /redo to
restore`.

Rust: the banner looks the shortcut up the same way, but `TuiKeymap::shortcut` only answers for a registered
command, and `session.redo` is E.10a's (`routes/session/actions.rs`). Until then the line is ` or /redo to restore`.
P-APP `E.6b/messages` (`open`) differs in those cells.

Reason: the command belongs to E.10a. When E.10a registers `session.redo`, the key shows with no change here;
E.10a removes this file and the `deviation` entry that names it.
