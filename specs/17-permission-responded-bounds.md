## Permission responded bounds

Bound the in-memory `responded` set in PermissionProvider

---

### Summary

`packages/app/src/context/permission.tsx` uses a module-local `responded = new Set<string>()` to prevent duplicate auto-responses for the same permission request ID. Entries are never cleared on success, so the set can grow without bound over a long-lived app session.

This spec caps the size of this structure while preserving its purpose (dedupe in-flight/recent IDs).

---

### Scoped files (parallel-safe)

- `packages/app/src/context/permission.tsx`

---

### Goals

- Prevent unbounded growth of `responded`
- Keep dedupe behavior for recent/in-flight permission IDs
- Avoid touching other modules

---

### Non-goals

- Changing permission auto-accept rules
- Adding persistence for responded IDs

---

### Proposed approach

- Replace `Set<string>` with an insertion-ordered `Map<string, number>` (timestamp) or keep `Set` but prune using insertion order by re-creating.
- Add a cap constant, e.g. `MAX_RESPONDED = 1000`.
- On `respondOnce(...)`:
  - insert/update the ID (refresh recency)
  - if size exceeds cap, delete oldest entries until within cap
- Keep the existing `.catch(() => responded.delete(id))` behavior for request failures.

Optional: add TTL pruning (e.g. drop entries older than 1 hour) when inserting.

---

### Implementation steps

1. Introduce `MAX_RESPONDED` and a small `pruneResponded()` helper

2. Update `respondOnce(...)` to refresh recency and prune

3. Keep failure rollback behavior

---

### Acceptance criteria

- `responded` never grows beyond `MAX_RESPONDED`
- Auto-respond dedupe still works for repeated events for the same permission ID in a short window

---

### Validation plan

- Manual:
  - Simulate many permission requests (or mock by calling `respondOnce` in dev)
  - Confirm the structure size stays capped
  - Confirm duplicate events for the same permission ID do not send multiple responses
