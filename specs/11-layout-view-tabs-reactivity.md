## Layout reactivity

Reduce per-call reactive overhead in `useLayout`

---

### Summary

`packages/app/src/context/layout.tsx` creates reactive effects inside `view(sessionKey)` and `tabs(sessionKey)` each time these helpers are called. Multiple consumers for the same key can accumulate duplicate watchers. This spec simplifies the API internals so calls stay lightweight while preserving behavior.

---

### Goals

- Remove avoidable per-call `createEffect` allocations in `view()` and `tabs()`
- Preserve scroll seeding, pruning, and touch semantics
- Keep external `useLayout` API stable

---

### Non-goals

- Persistence schema migration
- Session tab behavior redesign
- New layout features

---

### Parallel execution contract

This spec owns:

- `packages/app/src/context/layout.tsx`
- `packages/app/src/context/layout-scroll.test.ts` (if updates needed)

This spec should not modify:

- `packages/app/src/pages/session.tsx`
- `packages/app/src/components/session/*`

---

### Implementation plan

1. Consolidate key-touch logic

- Introduce shared internal helper, e.g. `ensureSessionKey(key)` that performs:
  - `touch(key)`
  - `scroll.seed(key)`

2. Remove per-call effects in `view()` / `tabs()`

- Replace internal `createEffect(on(key, ...))` usage with lazy key reads inside accessors/memos.
- Ensure reads still invoke `ensureSessionKey` at safe points.

3. Keep return API stable

- Preserve current method names and behavior:
  - `view(...).scroll`, `setScroll`, `terminal`, `reviewPanel`, `review`
  - `tabs(...).active`, `all`, `open`, `close`, `move`, etc.

4. Verify pruning behavior

- Ensure session-key pruning still runs when key set grows and active key changes.

---

### Acceptance criteria

- `view()` and `tabs()` no longer instantiate per-call key-change effects.
- Existing callers do not require API changes.
- Scroll restore and tab persistence still work across session navigation.
- No regressions in handoff/pending-message behavior.

---

### Validation plan

- Manual:
  - Navigate across multiple sessions; verify tabs + review open state + scroll positions restore.
  - Toggle terminal/review panels and confirm persisted state remains consistent.
- Tests:
  - Update/add targeted tests for key seeding/pruning if behavior changed.

---

### Risks and mitigations

- Risk: subtle key-touch ordering changes affect prune timing.
  - Mitigation: keep `touch` and `seed` coupled through one helper and verify prune boundaries.
- Risk: removing effects misses updates for dynamic accessor keys.
  - Mitigation: ensure every public accessor path reads current key and calls helper.
