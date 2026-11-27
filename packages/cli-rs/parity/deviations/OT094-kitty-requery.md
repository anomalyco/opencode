# OT094: Core queries the Kitty keyboard flags again after pushing them

TypeScript (`@opentui/core` 0.9.4, since #63989): at startup the renderer queries the Kitty keyboard flags (`CSI ? u`),
pushes its flags (`CSI > 5 u`), and queries them once more. `parity/scenarios/M.4/mono-keyboard.pty.ts` records
`?`, `>5`, `?` by the settings checkpoint, and `?`, `>5`, `?`, `<` once mono pops the flags.

Rust (OpenTUI 0.9.4's Rust crates): `?`, `>5`, and `<` after mono; no second query.

Reason: terminal setup is OpenTUI's; the extra query changes nothing on screen or in the keys the client reads. 2
lines a checkpoint. It goes away when the Rust crates confirm the push as Core does, or Core stops.
