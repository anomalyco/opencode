# O89: a message jump lands at the top when the rows fit the view

**TypeScript.** `alignMessage` in `routes/session/index.tsx` sizes the navigation slack with
`messageNavigationSlack`, from `scroll.scrollHeight` less the current slack. OpenTUI's scroll content is at least
as tall as the viewport, so while the rows are shorter than the view the height counts empty rows, the slack comes
out short, and `scrollTo` clamps. In a session whose rows fit the screen, Next message shows "Jump to latest" and
does not move; after a new message it moves part of the way.

**Rust.** `routes/session/scroll.rs` measures the rows to where the slack starts, so the slack is what the target
needs and the message lands at the top, as it does in a longer session.

**Reason.** A TS defect fixed in Rust (O-89): a jump must land on its target.
