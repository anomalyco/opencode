## Cache eviction

Add explicit bounds for long-lived in-memory state

---

### Summary

Several in-memory caches grow without limits during long sessions. We’ll introduce explicit eviction (LRU + TTL + size caps) for sessions/messages/file contents and global per-directory sync stores.

---

### Goals

- Prevent unbounded memory growth from caches that survive navigation
- Add consistent eviction primitives shared across contexts
- Keep UI responsive under heavy usage (many sessions, large files)

---

### Non-goals

- Perfect cache hit rates or prefetch strategies
- Changing server APIs or adding background jobs
- Persisting caches for offline use

---

### Current state

- Global sync uses per-directory child stores without eviction in `packages/app/src/context/global-sync.tsx`.
- File contents cached in `packages/app/src/context/file.tsx` with no cap.
- Session-heavy pages include `packages/app/src/pages/session.tsx` and `packages/app/src/pages/layout.tsx`.

---

### Proposed approach

- Introduce a shared cache utility that supports:
  - `maxEntries`, `maxBytes` (approx), and `ttlMs`
  - LRU ordering with explicit `touch(key)` on access
  - deterministic `evict()` and `clear()` APIs
- Apply the utility to:
  - global-sync per-directory child stores (cap number of directories kept “hot”)
  - file contents cache (cap by entries + bytes, with TTL)
  - session/message caches (cap by session count, and optionally message count)
- Add feature flags per cache domain to allow partial rollout (e.g. `cache.eviction.files`).

---

### Phased implementation steps

1. Add a generic cache helper

- Create `packages/app/src/utils/cache.ts` with a small, dependency-free LRU+TTL.
- Keep it framework-agnostic and usable from Solid contexts.

Sketch:

```ts
type CacheOpts = {
  maxEntries: number
  ttlMs?: number
  maxBytes?: number
  sizeOf?: (value: unknown) => number
}

function createLruCache<T>(opts: CacheOpts) {
  // get, set, delete, clear, evictExpired, stats
}
```

2. Apply eviction to file contents

- In `packages/app/src/context/file.tsx`:
  - wrap the existing file-content map in the LRU helper
  - approximate size via `TextEncoder` length of content strings
  - evict on `set` and periodically via `requestIdleCallback` when available
- Add a small TTL (e.g. 10–30 minutes) to discard stale contents.

3. Apply eviction to global-sync child stores

- In `packages/app/src/context/global-sync.tsx`:
  - track child stores by directory key in an LRU with `maxEntries`
  - call a `dispose()` hook on eviction to release subscriptions and listeners
- Ensure “currently active directory” is always `touch()`’d to avoid surprise evictions.

4. Apply eviction to session/message caches

- Identify the session/message caching touchpoints used by `packages/app/src/pages/session.tsx`.
- Add caps that reflect UI needs (e.g. last 10–20 sessions kept, last N messages per session if cached).

5. Add developer tooling

- Add a debug-only stats readout (console or dev panel) for cache sizes and eviction counts.
- Add a one-click “clear caches” action for troubleshooting.

---

### Data migration / backward compatibility

- No persisted schema changes are required since this targets in-memory caches.
- If any cache is currently mirrored into persistence, keep keys stable and only change in-memory retention.

---

### Risk + mitigations

- Risk: evicting content still needed causes extra refetches and flicker.
  - Mitigation: always pin “active” entities and evict least-recently-used first.
- Risk: disposing global-sync child stores could leak listeners if not cleaned up correctly.
  - Mitigation: require an explicit `dispose()` contract and add dev assertions for listener counts.
- Risk: approximate byte sizing is imprecise.
  - Mitigation: combine entry caps with byte caps and keep thresholds conservative.

---

### Validation plan

- Add tests for `createLruCache` covering TTL expiry, LRU ordering, and eviction triggers.
- Manual scenarios:
  - open many files and confirm memory stabilizes and UI remains responsive
  - switch across many directories and confirm global-sync does not continuously grow
  - long session navigation loop and confirm caches plateau

---

### Rollout plan

- Land cache utility first with flags default off.
- Enable file cache eviction first (lowest behavioral risk).
- Enable global-sync eviction next with conservative caps and strong logging in dev.
- Enable session/message eviction last after observing real usage patterns.

---

### Open questions

- What are the current session/message cache structures and their ownership boundaries?
- Which child stores in `global-sync.tsx` have resources that must be disposed explicitly?
- What caps are acceptable for typical workflows (files open, directories visited, sessions viewed)?
