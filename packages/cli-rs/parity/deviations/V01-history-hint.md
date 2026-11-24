# V01: "Loading session history…" during a scroll backfill

TypeScript: the row under the transcript shows `Loading session history…` only while `session.first` loads every
older page (`routes/session/index.tsx:1574-1576`). A scroll near the top loads the next older page with no hint.

Rust: the same row shows `Loading session history…` while any older page loads, including the page a scroll
near the top asks for (`crates/tui/src/routes/session/messages/list.rs`, `load_older`).

Reason: on a slow server the reader otherwise sees the top of the transcript with no sign that more is coming.
The text, color (`text.feedback.info`), and place are TypeScript's. When E.8 adds `session.first`, it shows the
same hint for its load.
