# M05: mini's footer views

## No mouse in the footer

- TypeScript: hovering a permission button or a form row selects it, and a click picks it. In the subagent
  inspector, a click on `esc back` closes it and a click on `tab next` shows the next child.
- Rust: keys only.
- Reason: mini runs with mouse tracking off (M.1), so the footer never sees the pointer.

## A child's listed permissions read their source messages

- TypeScript: listing a child's permissions reads the source message only of a request whose tool call the child's
  transcript does not hold yet, and a source that cannot be read fails the list, which then retries.
- Rust: every listed request with a tool source reads its message, as the session's own permissions do, and a
  source that cannot be read leaves the request without its tool input.
- Reason: the session's permissions already resolve this way (`source` in `footers/mod.rs`). The screen is the
  same whenever the server answers; only extra reads differ.
