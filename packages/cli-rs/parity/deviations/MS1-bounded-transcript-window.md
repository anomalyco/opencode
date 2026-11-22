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
  - A mount above that comes before the layout of a drop (message navigation retries in the same pass) takes the
    dropped height off the content height it holds the view by.
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
`tests/all/navigate.rs` under "The window" check this. Plugins see two differences:
- **The published transcript (`TranscriptView`)** covers the bounded window. Its `rows`, `offset` and `extent` cover
  the rows near the view, `above` still counts every message before the window, and the window reaches the newest row
  only while the view is near it. Its docs (`plugin-abi/src/v2/geometry.rs`) say so.
- **A plugin-claimed row is mounted again each time it comes back** into the window. In TS it stays mounted from the
  time it is revealed until the view returns to the tail.
  - A tool call's new mount keeps its `MountId` key (the call's ID), with a new generation.
  - It starts with an empty memo table (a cache: the view builds its tree once more).
  - It calls the view again, also when an earlier mount had fallen back to the host's row.
  - A fence's key was already new whenever its Markdown is built.
  - No plugin in this repo claims tool rows, and none keeps state by mount. The ABI already ends what a mount owned
    with its generation (`MountId`), so nothing is kept across a remount. The claim docs
    (`plugin-abi/src/claim.rs`) now tell plugins to keep a call's state under the key.

Reason: on a session of 13,415 messages, paging from Home to the end held every row passed. That came to 1.02 GiB,
about 70% of it OpenTUI's native nodes and text buffers, and CPU per key grew from 0.9 ms to 6.7 ms with the rows
mounted (`next/memory/report.md`). With the window bounded, both stay flat.
