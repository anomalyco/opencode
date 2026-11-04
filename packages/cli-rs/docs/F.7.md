# F.7 store core: design

`opencode-store` ports the session half of `createData` (`packages/client/src/solid/data.ts`):
session info and families, session status, messages and their parts, pending inbox items with
optimistic prompt and compaction admission, pending permissions, and rehydration on
`server.connected`. F.8 adds forms, projects, shells, locations, and the rest.

## Shape

- `Data` is a cheap `Clone` handle (`Arc`) around one `std::sync::Mutex<State>` and an
  `opencode_api::client::Client`. `State` is plain data with read accessors; the UI thread
  locks it to render (`data.read(|state| …)`). No lock is held across an `.await`.
- Network work runs on the tokio runtime captured when `Data` is created, so `Data` can be used
  from the opentui UI thread without a runtime context. TS promises are eager; here every
  request is spawned at once and the returned future only waits for it. Dropping the future
  does not cancel the request, as in TS.
- `createSync` becomes `Syncs` (`state.rs`): per key, a spawned load shared by all callers
  (`futures_util::future::Shared`), the same invalidation rules (a started load that is
  invalidated is followed by one reload; a load not yet started is not), and `complete`.
- Errors are `opencode_store::Error = Arc<opencode_api::error::Error>`, so a shared load gives
  every caller the same error.

## Events

`Data::apply(batch)` applies one batch from F.3's `connect()` receiver under one change flush.
Each handler is the TS `handleEvent` arm, with the same "drop when the target is not loaded"
rules. Follow-up reads (`refresh` in TS) are spawned after the lock is released, and skipped
while the connection is not connected or after `dispose()`. A `SessionNotFoundError` from a
refresh marks the session deleted, as in TS.

`V2Event::merge` (in `crates/api`, on the `Event` impl) folds adjacent `session.text.delta` and
`session.reasoning.delta` with the same `(sessionID, assistantMessageID, ordinal)`, and
`session.tool.input.delta` with the same `(sessionID, assistantMessageID, id)`. That is exact,
because the handlers only append the delta.

`connection::run(data, receiver, state)` drives the store: it applies batches and invalidates
every cached read whenever the F.3 connection leaves `Connected` (the TS `createEffect`).
`server.connected` reconciles `session.active` against status events received during the read.

## Change tracking

The UI re-renders on change notifications, so tracking must be cheap per session and per
message. Every mutation records what it touched in the current `Changes`:

| Field | Meaning |
| --- | --- |
| `sessions` | session list membership or order (create, delete, any info change) |
| `session` | `SessionID`s whose info changed |
| `status` | `SessionID`s whose running state changed |
| `messages` | `SessionID`s whose message list changed shape: insert, remove, reorder, reload, page |
| `message` | `(SessionID, SessionMessageID)` whose content changed (a delta, a tool update) |
| `pending` | `SessionID`s whose pending inbox items changed |
| `permissions` | `SessionID`s whose pending permissions changed |

A flush (end of a batch, or a finished read) gives the changes a revision, keeps the last 256
flushes in a log, and sends the revision on a `tokio::sync::watch`. A view keeps the revision it
last rendered and calls `data.changes_since(seen)`; it gets the union of newer flushes, or
`Changes { all: true }` when its revision fell out of the log. Queries such as
`changes.message(&session, &message)` answer true when that message, its list, or everything
changed. Many views can observe independently, and nothing is unbounded.

## Not ported here

- Forms, projects, shells, locations and their events (`worktree.resolved`, credentials,
  catalogs) are F.8. `server.connected` here rehydrates session status only; F.8 adds the
  location, VCS, and project reads.
- `omitToolFileData` is a constructor flag, as in TS.
