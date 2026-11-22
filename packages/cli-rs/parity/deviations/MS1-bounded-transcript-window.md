# MS1: the transcript window drops rows on the far side of the view

TypeScript: the transcript mounts a window of rows (`routes/session/index.tsx:430-530`).
- The window only grows away from the tail: `revealOlderRows` moves its start up and `revealNewerRows` moves
  `visibleRowsEnd` down, and neither drops rows on the other side.
- It shrinks only when the view returns to the tail.
- Message navigation and jumps (`ensureAllRows`, `index.tsx:505`) mount every loaded row first.
- What a row's widgets opened (a tool's output, a failed call's error, a turn's token table) is local to the widget,
  and so is lost when the row unmounts, as it is at the tail.

Rust:
- A move that mounts rows on one side of the view drops the rows more than `MARGIN` (60, by weight) past the other
  side (`crates/tui/src/routes/session/messages/list.rs`, `Inner::grow`).
  - Rows dropped above the view take the scroll offset with them, so the rows on screen stay put.
  - Rows dropped below the view drop after the next layout, once the rows mounted above it are laid out.
- Message navigation searches the mounted rows. When the target is not among them, it mounts the next
  `BACKFILL_CHUNK` rows that way and looks again (`navigation.rs`, `to_message`).
- A jump to a message mounts `BACKFILL_CHUNK` rows on each side of it, unless it is mounted already (`jump`,
  `mount_message`). An alignment short of the newest row mounts newer rows instead of adding slack.
- What the reader opened in a row is kept by the transcript for the session (`Toggles`), keyed by tool call ID or
  message ID. A row that drops and comes back opens as the reader left it, also after a trip to the tail. Groups
  kept theirs already, in the session's settings.
- While a mouse selection holds text, no row drops, so the selection keeps its text. Any key clears the selection,
  and rows drop again from the next move. So memory grows past the window only while the reader scrolls with a
  selection held.

Nothing on screen differs: the rows, their places and every move are the same. The tests in
`tests/all/navigate.rs` under "The window" check this, with one exception: a plugin reading the published transcript
sees fewer rows in `rows`; `above` still counts every message above the window.

Reason: on a session of 13,415 messages, paging from Home to the end held every row passed. That came to 1.02 GiB,
about 70% of it OpenTUI's native nodes and text buffers, and CPU per key grew from 0.9 ms to 6.7 ms with the rows
mounted (`next/memory/report.md`). With the window bounded, both stay flat.
