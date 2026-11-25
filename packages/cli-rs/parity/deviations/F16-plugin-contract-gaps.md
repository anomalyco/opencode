# F16: a plugin's field text in the host's color

**TypeScript.** A TUI plugin's `<input>` is OpenTUI's `InputRenderable`, which draws what the user types in its own
default text color, white, and its placeholder in its own gray, `#666666`, whatever the theme.

**Rust.** A plugin's field is the contract's `Node::Input`, the host's own field, which draws the typed text in the
theme's text color (`text.base`) and its placeholder in the muted one (`text.muted`), as the composer and the host's
dialogs do.

**Reason.** The field is the host's, so it looks as the host's fields do on every carrier: a plugin on the JS host and
its Luau port draw the same.
`/` focuses the field the same call shows (contract 2.x, step B, the focus waits for the view that shows it), and the
rename prompt carries its `value` and `description` (contract ergonomics 2.6), which this deviation listed before.
