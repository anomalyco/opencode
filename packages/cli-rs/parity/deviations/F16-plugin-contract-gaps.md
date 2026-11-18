# F16: a plugin's field text in the host's color

**TypeScript.** A TUI plugin's `<input>` is OpenTUI's `InputRenderable`, which draws what the user types in its own
default text color, white, whatever the theme.

**Rust.** A plugin's field is the contract's `Node::Input`, the host's own field, which draws the typed text in the
theme's text color (`text.base`), as the composer and the host's dialogs do.

**Reason.** The field is the host's, so it looks as the host's fields do on every carrier: the published package on
the JS host and its native and Luau ports draw the same. `parity/scenarios/P.8/session-manager.app.ts` drives it: its
`search` checkpoint differs by the five cells of the typed word, in color only, and the rest of the scenario is equal.
`/` focuses the field the same call shows (contract 2.x, step B, the focus waits for the view that shows it), and the
rename prompt carries its `value` and `description` (contract ergonomics 2.6), which this deviation listed before.
