## Persist in-memory cache bounds

Fix unbounded `persist.ts` string cache growth

---

### Summary

`packages/app/src/utils/persist.ts` maintains a module-level `cache: Map<string, string>()` that mirrors values written to storage. This cache can retain very large JSON strings (prompt history, image dataUrls, terminal buffers) indefinitely, even after the underlying `localStorage` keys are evicted. Over long sessions this can become an in-process memory leak.

This spec adds explicit bounds (entries + approximate bytes) and makes eviction/removal paths delete from the in-memory cache.

---

### Scoped files (parallel-safe)

- `packages/app/src/utils/persist.ts`

---

### Goals

- Prevent unbounded memory growth from the module-level persist cache
- Ensure keys removed/evicted from storage are also removed from the in-memory cache
- Preserve current semantics when `localStorage` access throws (fallback mode)
- Keep changes self-contained to `persist.ts`

---

### Non-goals

- Changing persisted schemas or moving payloads out of KV storage (covered elsewhere)
- Introducing a shared cache utility used by multiple modules

---

### Current state

- `cache` stores raw strings for every key read/written.
- `evict()` removes items from `localStorage` but does not clear the corresponding entries from `cache`.
- When `localStorage` is unavailable (throws), reads fall back to `cache`, so the cache is also a functional in-memory persistence layer.

---

### Proposed approach

1. Replace `cache: Map<string, string>` with a bounded LRU-like map

- Store `{ value: string, bytes: number }` per key.
- Maintain a running `totalBytes`.
- Enforce caps:
  - `CACHE_MAX_ENTRIES` (e.g. 500)
  - `CACHE_MAX_BYTES` (e.g. 8 _ 1024 _ 1024)
- Use Map insertion order as LRU:
  - On `get`, re-insert the key to the end.
  - On `set`, insert/update then evict oldest until within bounds.
- Approximate bytes as `value.length * 2` (UTF-16) to avoid `TextEncoder` allocations.

2. Ensure all removal paths clear the in-memory cache

- In `localStorageDirect().removeItem` and `localStorageWithPrefix().removeItem`: already calls `cache.delete(name)`; keep.
- In `write(...)` failure recovery where it calls `storage.removeItem(key)`: also `cache.delete(key)`.
- In `evict(...)` loop where it removes large keys: also `cache.delete(item.key)`.

3. Add a small dev-only diagnostic (optional)

- In dev, expose a lightweight `cacheStats()` helper (entries, totalBytes) for debugging memory reports.

---

### Implementation steps

1. Introduce constants and cache helpers in `persist.ts`

- `const CACHE_MAX_ENTRIES = ...`
- `const CACHE_MAX_BYTES = ...`
- `function cacheSet(key: string, value: string)`
- `function cacheGet(key: string): string | undefined`
- `function cacheDelete(key: string)`
- `function cachePrune()`

2. Route all existing `cache.set/get/delete` calls through helpers

- `localStorageDirect()`
- `localStorageWithPrefix()`

3. Update `evict()` and `write()` to delete from cache when deleting from storage

4. (Optional) Add dev logging guardrails

- If a single value exceeds `CACHE_MAX_BYTES`, cache it but immediately prune older keys (or refuse to cache it and keep behavior consistent).

---

### Acceptance criteria

- Repeatedly loading/saving large persisted values does not cause unbounded `cache` growth (entries and bytes are capped)
- Values removed from `localStorage` by `evict()` are not returned later via the in-memory cache
- App remains functional when `localStorage` throws (fallback mode still returns cached values, subject to caps)

---

### Validation plan

- Manual:
  - Open app, perform actions that write large state (image attachments, terminal output, long sessions)
  - Use browser memory tools to confirm JS heap does not grow linearly with repeated writes
  - Simulate quota eviction (force small storage quota / fill storage) and confirm `cache` does not retain evicted keys indefinitely
