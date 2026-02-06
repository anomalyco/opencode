## File context domain split

Refactor `context/file.tsx` into focused modules with unchanged API.

---

### Summary

`packages/app/src/context/file.tsx` still combines path normalization, file-content caching/eviction, file-tree loading, watcher event handling, and file-view persistence orchestration. Recent refactoring extracted generic scoped-cache primitives to `packages/app/src/utils/scoped-cache.ts`, but most file-domain behavior remains in one module. This spec separates those concerns while preserving the existing `useFile()` interface.

---

### Goals

- Keep `useFile()` API stable for all callers.
- Extract independent domains into dedicated modules.
- Improve readability and lower risk for future file-tree/perf changes.
- Preserve current caching and watcher semantics.

---

### Non-goals

- No redesign of file tree UI.
- No change to backend file APIs.
- No simultaneous refactor of `components/file-tree.tsx` in this workstream.

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/src/context/file.tsx`
- New files under `packages/app/src/context/file/**`
- `packages/app/src/utils/scoped-cache.ts` (only when required for file-view cache extraction)

This workstream must not edit:

- `packages/app/src/context/global-sync.tsx` (spec 12)
- `packages/app/src/pages/session.tsx` (spec 09)
- `packages/app/src/components/prompt-input.tsx` (spec 11)

---

### Current state

- File size: ~751 LOC.
- `packages/app/src/utils/scoped-cache.ts` now exists as a shared cache primitive used by file view persistence.
- Multiple domains in one module:
  - path normalization/parsing
  - LRU content memory management
  - tree node/directory state management
  - event-driven watcher invalidation
  - per-session view cache bootstrapping

---

### Proposed module split

Create `packages/app/src/context/file/` modules such as:

- `path.ts` - normalize/strip helpers.
- `content-cache.ts` - content LRU + byte caps.
- `view-cache.ts` - per-session file view persistence cache (building on `createScopedCache`).
- `tree-store.ts` - directory/node store and list/expand/collapse actions.
- `watcher.ts` - watcher event handling and invalidation routines.

`file.tsx` remains the provider entry that composes these modules.

---

### Phased steps

1. Extract path helper functions with no behavior changes.
2. Extract content cache and eviction logic.
3. Extract file-specific view-cache loading/pruning logic on top of `createScopedCache`.
4. Extract tree-store list/refresh/toggle actions.
5. Extract watcher update handler and wire cleanup.
6. Keep `useFile()` return shape unchanged.

---

### Acceptance criteria

- `useFile()` API remains backward compatible.
- `context/file.tsx` is reduced significantly (target: under 350 LOC).
- Tree loading/refresh and content eviction behavior remain unchanged.
- Watcher-driven reload behavior still works for changed/added/deleted files.

---

### Validation plan

- Typecheck: `bun run typecheck` (from `packages/app`).
- Targeted e2e checks:
  - `e2e/files/file-tree.spec.ts`
  - `e2e/files/file-viewer.spec.ts`
  - `e2e/files/file-open.spec.ts`
- Manual checks:
  - directory expand/collapse and refresh
  - large file navigation and cache reuse
  - watcher-driven updates in active file tabs

---

### Handoff notes

- Keep tree/data stores colocated with their mutation helpers.
- Avoid changing persisted key names or cache key shapes in this pass.
- Save broader API cleanups for a follow-up once modules are stable.
