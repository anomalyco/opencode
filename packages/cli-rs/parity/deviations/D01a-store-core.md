# D01a: store core differences

## `loadMore` has no `beforePublish` hook

- TypeScript: `session.message.loadMore(id, { beforePublish })` runs a callback inside the Solid
  batch that publishes the pages, so a view can measure before the store changes.
- Rust: `Data::message_load_more` publishes under the store lock. A view sees the pages on the next
  change flush, with `Changes::messages(id)` set.
- Reason: there is no reactive batch to hook into. A view that needs the "before" state reads it
  before it calls `message_load_more`.

## Cancellation is a `CancellationToken`

- TypeScript: `loadMore` takes an `AbortSignal`, passes it to `fetch`, and removes its listener
  when it settles.
- Rust: `LoadMore { cancel: Some(token) }`. Cancelling ends the wait and drops the request future.
  The visible results are the same, and `solid-data.test.ts` "bulk history" covers all seven cases.
- Reason: this is the tokio form of an abort signal.

## `session.moved` keeps the directory only

- TypeScript: the stored session `location` becomes the event's `location`, which can also carry
  `workspaceID`.
- Rust: the generated `SessionInfo.location` is `Location.PublicRef` (directory only), so the
  workspace ID is not stored.
- Reason: this follows the schema. Explicit workspace placement is reserved (root `AGENTS.md`).

## A second `server.connected` invalidates every cached read

- TypeScript: `server.connected` reads `session.active` and the default location again and calls
  `vcs.sync` and `project.sync`, which do nothing while their reads are cached. The cache is
  invalidated only when `config.connection` reports a status other than `connected`.
- Rust: every `server.connected` after the first invalidates every cached read and flushes
  `Changes::everything`, so VCS and the projects are read again with the rest
  (`State::apply_event`, `crates/store/src/connection.rs`). The F.7 fold oracle
  (`parity/fixtures/F.7/folds.json`, `server.connected@loaded`) records the two extra reads.
- Reason: a reconnect that the status watch coalesced, or a queue-full drop (A09-bounded-queue),
  never shows a disconnected status, and the events of the old stream are lost (F.7 review,
  carbon-1).
