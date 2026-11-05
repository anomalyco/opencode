# M04, M09, M13: mini's footer prompt

## The footer resizes once per frame

- TypeScript: Solid batches the prompt's rows, so a menu that opens and closes inside one burst of input never
  resizes the split footer.
- Rust: the prompt measures after every key. The footer height is now applied in a step before the next frame,
  so the same burst resizes the footer once, to its final height.
- Reason: a split footer that grows scrolls the transcript up, and shrinking does not bring it back. Without this,
  pasting `/editor seed` scrolled the transcript by the menu's rows.

## The external editor leaves the transcript where it was

- TypeScript: when the screen is full, the transcript sits one row higher after `$EDITOR` returns (Core's resume).
- Rust: the transcript stays where it was.
- Reason: the row is lost in Core's suspend and resume, not chosen. The `editor` scenario runs with `--no-replay`
  so the screen is not full and both sides match.

## The status row does not wrap

- TypeScript: when the required groups (the two-press hint, the status, `esc normal`) are wider than the terminal,
  the status row wraps and the footer grows.
- Rust: the status row stays one row and truncates.
- Reason: it happens only below about 20 columns; the footer height model stays simpler.
