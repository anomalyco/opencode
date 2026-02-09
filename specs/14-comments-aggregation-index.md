## Comments indexing

Avoid repeated flatten+sort for comment aggregates

---

### Summary

`packages/app/src/context/comments.tsx` derives `all` by flattening all file comment arrays and sorting on every change. This is simple but can become expensive with many comments. We will maintain an indexed aggregate structure incrementally.

---

### Goals

- Keep `comments.list(file)` behavior unchanged
- Make `comments.all()` retrieval near O(1) for reads
- Preserve chronological ordering guarantees

---

### Non-goals

- Persisting comments in a new schema
- Adding new comment metadata fields
- UI changes for comment display

---

### Parallel execution contract

This spec owns:

- `packages/app/src/context/comments.tsx`
- Optional tests for comments context

This spec should not modify:

- `packages/app/src/pages/session.tsx`
- `packages/ui/src/components/line-comment.tsx`

---

### Implementation plan

1. Add aggregate index state

- Maintain `commentsByFile` (existing) plus an `allComments` array in chronological order.
- Keep both updated through the same mutator paths.

2. Update mutators

- `add`: append new comment to file list and aggregate list.
- `remove`: remove from file list and aggregate list by id/file.
- `clear`: reset both structures and focus/active state.

3. Simplify selectors

- `list(file)` reads file list directly.
- `all()` returns pre-indexed aggregate list without per-read flatten+sort.

---

### Acceptance criteria

- `comments.all()` no longer flattens and sorts every reactive run.
- Comment order stays chronological by `time`.
- `add/remove/clear/focus/active` semantics remain unchanged.

---

### Validation plan

- Manual:
  - Add multiple comments across different files.
  - Remove one comment and verify both file-level and global views update correctly.
  - Submit prompt (which clears comments) and verify reset behavior.
- Optional unit test:
  - add/remove/clear keeps aggregate ordering and integrity.

---

### Risks and mitigations

- Risk: aggregate list and per-file lists diverge.
  - Mitigation: funnel all writes through centralized mutators; avoid direct store writes elsewhere.
- Risk: ID collision edge cases.
  - Mitigation: keep UUID creation unchanged and remove by `file + id` pair.
