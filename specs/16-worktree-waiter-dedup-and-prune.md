## Worktree waiter dedup + pruning

Prevent `Worktree.wait()` from accumulating resolver closures

---

### Summary

`packages/app/src/utils/worktree.ts` stores `waiters` as `Map<string, Array<(state) => void>>`. If multiple callers call `wait()` while a directory is pending (or when callers stop awaiting due to their own timeouts), resolver closures can accumulate until a `ready()`/`failed()` event arrives.

In this app, `Worktree.wait()` is used inside a `Promise.race` with a timeout, so it is possible to create many resolvers that remain stored for a long time.

This spec changes `wait()` to share a single promise per directory key (dedup), eliminating unbounded waiter arrays. Optionally, it prunes resolved state entries to keep the map small.

---

### Scoped files (parallel-safe)

- `packages/app/src/utils/worktree.ts`

---

### Goals

- Ensure there is at most one pending promise per directory key
- Avoid accumulating arrays of resolver closures
- Keep current API surface for callers (`Worktree.wait(directory)`)

---

### Non-goals

- Adding abort/cancel APIs that require callsite changes
- Changing UI behavior around worktree readiness

---

### Proposed approach

1. Replace `waiters` with a single in-flight promise per key

- Change:
  - from: `Map<string, Array<(state: State) => void>>`
  - to: `Map<string, { promise: Promise<State>; resolve: (state: State) => void }>`

2. Implement `wait()` dedup

- If state is present and not pending: return `Promise.resolve(state)`.
- Else if there is an in-flight waiter entry: return its `promise`.
- Else create and store a new `{ promise, resolve }`.

3. Resolve and clear on `ready()` / `failed()`

- When setting state to ready/failed:
  - look up waiter entry
  - delete it
  - call `resolve(state)`

4. (Optional) prune resolved state entries

- Keep pending states.
- Drop old ready/failed entries if `state.size` exceeds a small cap.

---

### Implementation steps

1. Refactor `waiters` representation

2. Update `Worktree.wait`, `Worktree.ready`, `Worktree.failed`

3. Add small inline comments describing dedup semantics

---

### Acceptance criteria

- Calling `Worktree.wait(directory)` repeatedly while pending does not grow `waiters` unbounded
- `ready()` and `failed()` still resolve any in-flight waiter promise
- Existing callsites continue to work without modification

---

### Validation plan

- Manual (or small ad-hoc dev snippet):
  - call `Worktree.pending(dir)`
  - call `Worktree.wait(dir)` many times
  - confirm only one waiter entry exists
  - call `Worktree.ready(dir)` and confirm all awaiting callers resolve
