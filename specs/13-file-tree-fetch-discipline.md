## File tree fetches

Make directory listing triggers explicit and minimal

---

### Summary

`packages/app/src/components/file-tree.tsx` currently invokes `file.tree.list(path)` from a generic effect in each tree instance. Even with inflight guards, this pattern causes avoidable list calls and makes load behavior harder to reason about. This spec tightens fetch triggers.

---

### Goals

- Avoid redundant list invocations from passive rerenders
- Fetch directory data only when needed (mount + expansion + explicit refresh)
- Keep tree behavior unchanged for users

---

### Non-goals

- Replacing recursive tree rendering with virtualization
- Changing file-tree visual design
- Backend/API changes for file listing

---

### Parallel execution contract

This spec owns:

- `packages/app/src/components/file-tree.tsx`

This spec should not modify:

- `packages/app/src/context/file.tsx`
- `packages/app/src/pages/session.tsx`

---

### Implementation plan

1. Replace broad list effect with explicit triggers

- Load root path on mount.
- For nested directories, list only when:
  - node is expanded, or
  - parent explicitly requests refresh.

2. Guard expansion-driven fetches

- Keep `file.tree.expand(path)` as the primary source of truth for expansion fetches.
- Ensure passive rerenders do not retrigger `list(path)` calls for already loaded dirs.

3. Keep filter auto-expand behavior

- Preserve existing "allowed filter" directory auto-expansion.
- Ensure auto-expanded directories still fetch exactly once unless force refresh occurs.

---

### Acceptance criteria

- `file-tree.tsx` no longer calls `file.tree.list(path)` from an unscoped rerender effect.
- Expanding a folder still loads its children correctly.
- Filtering by `allowed` still opens and shows required parent directories.
- No regressions in change/all tabs where `FileTree` is used.

---

### Validation plan

- Manual:
  - Expand/collapse deep directory trees repeatedly.
  - Switch between "changes" and "all" tree tabs.
  - Open review, click files, verify tree stays responsive.
- Optional instrumentation:
  - count list calls per user action and compare before/after.

---

### Risks and mitigations

- Risk: directories fail to load when expansion timing changes.
  - Mitigation: rely on `expand()` path and verify for root + nested nodes.
- Risk: filter-driven auto-expand misses one level.
  - Mitigation: keep existing auto-expand iteration and add regression checks.
