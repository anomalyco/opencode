## GlobalSync message/part cleanup

Prevent stale message parts and per-session maps from accumulating

---

### Summary

`packages/app/src/context/global-sync.tsx` keeps per-directory child stores that include:

- `message: { [sessionID]: Message[] }`
- `part: { [messageID]: Part[] }`

Currently:

- `message.removed` removes the message from `message[sessionID]` but does not delete `part[messageID]`.
- `session.deleted` / archived sessions remove the session from the list but do not clear `message[...]`, `part[...]`, `session_diff[...]`, `todo[...]`, etc.

This can retain large arrays long after they are no longer reachable from UI.

This spec adds explicit cleanup on the relevant events without changing cache strategy or introducing new cross-module eviction utilities.

---

### Scoped files (parallel-safe)

- `packages/app/src/context/global-sync.tsx`

---

### Goals

- Delete `part[messageID]` when a message is removed
- Clear per-session maps when a session is deleted or archived
- Keep changes limited to event handling in `global-sync.tsx`

---

### Non-goals

- Implementing LRU/TTL eviction across sessions/directories (separate work)
- Changing how `sync.tsx` or layout prefetch populates message caches

---

### Current state

- Message list and part map can diverge over time.
- Deleting/archiving sessions does not reclaim memory for message history, parts, diffs, todos, permissions, questions.

---

### Proposed approach

Add small helper functions inside `createGlobalSync()` to keep event handler readable:

- `purgeMessageParts(setStore, messageID)`
- `purgeSessionData(store, setStore, sessionID)`
  - delete `message[sessionID]`
  - for each known message in that list, delete `part[messageID]`
  - delete `session_diff[sessionID]`, `todo[sessionID]`, `permission[sessionID]`, `question[sessionID]`, `session_status[sessionID]`

Then wire these into the existing event switch:

- `message.removed`: after removing from `message[sessionID]`, also delete `part[messageID]`
- `session.updated` when `time.archived` is set: call `purgeSessionData(...)`
- `session.deleted`: call `purgeSessionData(...)`

Notes:

- Use `setStore(produce(...))` to `delete` object keys safely.
- Purge should be idempotent (safe if called when keys are missing).

---

### Implementation steps

1. Add purge helpers near the event listener in `global-sync.tsx`

2. Update event handlers

- `message.removed`
- `session.updated` (archived path)
- `session.deleted`

3. (Optional) Tighten `message.part.removed`

- If a part list becomes empty after removal, optionally delete `part[messageID]` as well.

---

### Acceptance criteria

- After a `message.removed` event, `store.part[messageID]` is `undefined`
- After `session.deleted` or archive, all per-session maps for that `sessionID` are removed
- No runtime errors when purging sessions/messages that were never hydrated

---

### Validation plan

- Manual:
  - Load a session with many messages
  - Trigger message delete/remove events (or simulate by calling handlers in dev)
  - Confirm the associated `part` entries are removed
  - Delete/archive a session and confirm globalSync store no longer holds its message/part data
