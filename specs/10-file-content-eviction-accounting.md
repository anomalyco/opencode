## File cache accounting

Make file-content eviction bookkeeping O(1)

---

### Summary

`packages/app/src/context/file.tsx` currently recomputes total cached bytes by reducing the entire LRU map inside the eviction loop. This creates avoidable overhead on large file sets. We will switch to incremental byte accounting while keeping LRU behavior unchanged.

---

### Goals

- Remove repeated full-map reductions from eviction path
- Maintain accurate total byte tracking incrementally
- Preserve existing eviction semantics (entry count + byte cap)

---

### Non-goals

- Changing cache limits
- Changing file loading API behavior
- Introducing cross-session shared caches

---

### Parallel execution contract

This spec owns:

- `packages/app/src/context/file.tsx`
- Optional tests in `packages/app/src/context/*file*.test.ts`

This spec should not modify:

- `packages/app/src/pages/session.tsx`
- `packages/app/src/components/file-tree.tsx`

---

### Implementation plan

1. Introduce incremental byte counters

- Add module-level `contentBytesTotal`.
- Add helper(s):
  - `setContentBytes(path, nextBytes)`
  - `removeContentBytes(path)`
  - `resetContentBytes()`

2. Refactor LRU touch/update path

- Keep `contentLru` as LRU order map.
- Update byte total only when a path is inserted/updated/removed.
- Ensure replacing existing byte value updates total correctly.

3. Refactor eviction loop

- Use `contentBytesTotal` in loop condition instead of `Array.from(...).reduce(...)`.
- On eviction, remove from both `contentLru` and byte counter.

4. Keep scope reset correct

- On directory scope change, clear inflight maps + `contentLru` + byte counter.

---

### Acceptance criteria

- `evictContent` performs no full-map reduction per iteration.
- Total bytes remain accurate after:
  - loading file A
  - loading file B
  - force-reloading file A with a different size
  - evicting entries
  - scope reset
- Existing caps (`MAX_FILE_CONTENT_ENTRIES`, `MAX_FILE_CONTENT_BYTES`) continue to enforce correctly.

---

### Validation plan

- Manual:
  - Open many files with mixed sizes and verify old files still evict as before.
  - Switch directory scope and verify cache clears safely.
- Optional unit coverage:
  - size counter updates on overwrite + delete.
  - eviction condition uses count and bytes as expected.

---

### Risks and mitigations

- Risk: byte counter drifts from map contents.
  - Mitigation: route all updates through centralized helpers.
- Risk: stale bytes retained on early returns.
  - Mitigation: assert cleanup paths in `finally`/scope reset still execute.
