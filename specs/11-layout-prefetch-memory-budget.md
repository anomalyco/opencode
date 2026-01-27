## Layout prefetch memory budget

Reduce sidebar hover prefetch from ballooning message caches

---

### Summary

`packages/app/src/pages/layout.tsx` prefetches message history into `globalSync.child(directory)`.

On hover and navigation, the current implementation can prefetch many sessions (each up to `prefetchChunk = 600` messages + parts). Since the global sync store has no eviction today, scanning the sidebar can permanently grow memory.

This spec limits how much we prefetch (chunk size + number of sessions) and adds debounced hover prefetch to avoid accidental flooding.

---

### Scoped files (parallel-safe)

- `packages/app/src/pages/layout.tsx`

---

### Goals

- Reduce the maximum amount of data prefetched per session
- Limit the number of sessions that can be prefetched per directory per app lifetime
- Avoid triggering prefetch for brief/accidental hovers
- Keep changes local to `layout.tsx`

---

### Non-goals

- Implementing eviction of already-prefetched data inside global sync (separate work)
- Changing server APIs

---

### Current state

- `prefetchChunk` is 600.
- Hovering many sessions can enqueue many prefetches over time.
- Once prefetched, message/part data remains in memory until reload.

---

### Proposed approach

1. Lower the prefetch page size

- Change `prefetchChunk` from 600 to a smaller value (e.g. 200).
- Rationale: prefetch is for fast first render; the session page can load more as needed.

2. Add a per-directory prefetch budget

- Track a small LRU of prefetched session IDs per directory (Map insertion order).
- Add `PREFETCH_MAX_SESSIONS_PER_DIR` (e.g. 8-12).
- Before queueing a new prefetch:
  - if already cached in `store.message[sessionID]`, allow
  - else if budget exceeded and priority is not `high`, skip
  - else allow and record in LRU

3. Debounce hover-triggered prefetch

- For sidebar session entries that call `prefetchSession(..., "high")` on hover:
  - schedule after ~150-250ms
  - cancel if pointer leaves before the timer fires

---

### Implementation steps

1. Update constants in `layout.tsx`

- `prefetchChunk`
- add `prefetchMaxSessionsPerDir`

2. Add `prefetchedByDir: Map<string, Map<string, true>>` (or similar)

- Helper: `markPrefetched(directory, sessionID)` with LRU behavior and max size.
- Helper: `canPrefetch(directory, sessionID, priority)`.

3. Integrate checks into `prefetchSession(...)`

4. Debounce hover prefetch in the sidebar session item component (still in `layout.tsx`)

---

### Acceptance criteria

- Prefetch requests never fetch more than the new `prefetchChunk` messages per session
- For a given directory, total prefetched sessions does not exceed the configured budget (except current/adjacent high-priority navigations if explicitly allowed)
- Rapid mouse movement over the session list does not trigger a prefetch storm

---

### Validation plan

- Manual:
  - Open sidebar with many sessions
  - Move cursor over session list quickly; confirm few/no prefetch requests
  - Hover intentionally; confirm prefetch happens after debounce
  - Confirm the number of prefetched sessions per directory stays capped (via dev logging or inspecting store)
