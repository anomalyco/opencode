# CF3: a plugin prompt's value on one line, and its description in the host's color

**TypeScript.** A plugin's `ui.dialog.prompt` is `DialogPrompt`: a one-row textarea that starts with `value` as
given, line breaks included, and moves the cursor to the end of the first line, so a value `"Old title\n"` shows
`Old title` and submits `"Old title\n"`. `description` is the plugin's `<text>` above the field, in OpenTUI's default
text color, white whatever the theme, at any length.

**Rust.** The host's prompt drops a value's line breaks before the field gets it (`"a\r\nb\n"` starts as `a b`) and
bounds the value and the description to one node's text (`limits.text`). The description is drawn in the color of
the host's own prompt descriptions (`text.muted`), over at most eight rows, so the field stays on screen.

**Reason.** The field is the host's one-row field, which scrolled a value with a line break off its only row and
showed nothing; a value on one line is what the user can see and edit. White is invisible on a light dialog, and an
unbounded description pushed the field off screen.
