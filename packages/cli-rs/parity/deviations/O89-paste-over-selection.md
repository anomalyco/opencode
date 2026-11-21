# O89: a paste chip over a selection marks its own label

**TypeScript.** `pasteText` and `pasteAttachment` in `component/prompt/index.tsx` take the extmark's start from
`input.cursorOffset`, then `insertText` replaces the selection. A selection made with Shift+Right ends after the
cursor (OpenTUI's selection takes the character at its far end), so the label lands at the selection's start and
the extmark one or more offsets after it. Submitting `a`, Up, Shift+Right, then a three-line paste sends
`[l1\nl2\nl3`: the expansion replaces the wrong range.

**Rust.** `prompt/paste.rs` deletes the selection first, then takes the cursor, so the extmark covers the label and
the prompt sends the pasted text.

**Reason.** A TS defect fixed in Rust: the sent prompt must be what the prompt shows.
