## File content cache bounds

Add explicit caps for loaded file contents in `FileProvider`

---

### Summary

`packages/app/src/context/file.tsx` caches file contents in-memory (`store.file[path].content`) for every loaded file within the current directory scope. Over a long session (reviewing many diffs/files), this can grow without bound.

This spec adds an in-module LRU + size cap for file _contents_ only, keeping metadata entries while evicting the heavy payload.

---

### Scoped files (parallel-safe)

- `packages/app/src/context/file.tsx`

---

### Goals

- Cap the number of in-memory file contents retained per directory
- Optionally cap total approximate bytes across loaded contents
- Avoid evicting content that is actively being used/rendered
- Keep changes localized to `file.tsx`

---

### Non-goals

- Changing persisted file-view state (`file-view`) limits (already pruned separately)
- Introducing a shared cache utility used elsewhere

---

### Proposed approach

1. Track content entries in an LRU Map

- `const contentLru = new Map<string, number>()` where value is approximate bytes.
- On successful `load(path)` completion, call `touchContent(path, bytes)`.
- In `get(path)`, if the file has `content`, call `touchContent(path)` to keep active files hot.

2. Evict least-recently-used contents when over cap

- Add constants:
  - `MAX_FILE_CONTENT_ENTRIES` (e.g. 30-50)
  - `MAX_FILE_CONTENT_BYTES` (optional; e.g. 10-25MB)
- When evicting a path:
  - remove it from `contentLru`
  - clear `store.file[path].content`
  - set `store.file[path].loaded = false` (or keep loaded but ensure UI can reload)

3. Reset LRU on directory scope change

- The existing scope reset already clears `store.file`; also clear the LRU map.

---

### Implementation steps

1. Add LRU state + helper functions

- `approxBytes(fileContent)` (prefer `content.length * 2`)
- `touchContent(path, bytes?)`
- `evictContent(keep?: Set<string>)`

2. Touch on content load

- After setting `draft.content = x.data`, compute bytes and touch

3. Touch on `get()` usage

- If `store.file[path]?.content` exists, touch

4. Evict on every content set

- After `touchContent`, run eviction until within caps

---

### Acceptance criteria

- Loading hundreds of files does not grow memory linearly; content retention plateaus
- Actively viewed file content is not evicted under normal use
- Evicted files can be reloaded correctly when accessed again

---

### Validation plan

- Manual:
  - Load many distinct files (e.g. via review tab)
  - Confirm only the latest N files retain `content`
  - Switch back to an older file; confirm it reloads without UI errors
