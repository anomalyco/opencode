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
