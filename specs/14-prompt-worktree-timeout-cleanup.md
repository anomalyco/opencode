## Prompt worktree timeout cleanup

Clear `waitForWorktree()` timers to avoid retaining closures for 5 minutes

---

### Summary

`packages/app/src/components/prompt-input.tsx` creates a 5-minute `setTimeout` inside `waitForWorktree()` as part of a `Promise.race`. If the worktree becomes ready quickly, the timeout still stays scheduled until it fires, retaining its closure (which can capture session and UI state) for up to 5 minutes. Repeated sends can accumulate many concurrent long-lived timers.

This spec makes the timeout cancelable and clears it when the race finishes.

---

### Scoped files (parallel-safe)

- `packages/app/src/components/prompt-input.tsx`

---

### Goals

- Ensure the 5-minute timeout is cleared as soon as `Promise.race` resolves
- Avoid retaining large closures unnecessarily
- Keep behavior identical for real timeouts

---

### Non-goals

- Changing the worktree wait UX
- Changing the WorktreeState API

---

### Proposed approach

- Track the timeout handle explicitly:
  - `let timeoutId: number | undefined`
  - `timeoutId = window.setTimeout(...)`

- After `Promise.race(...)` resolves (success, abort, or timeout), call `clearTimeout(timeoutId)` when set.

- Keep the existing 5-minute duration and result handling.

---

### Implementation steps

1. In `waitForWorktree()` create the timeout promise with an outer `timeoutId` variable

2. After awaiting the race, clear the timeout if it exists

3. Ensure `pending.delete(session.id)` and UI cleanup behavior remains unchanged

---

### Acceptance criteria

- When the worktree becomes ready quickly, no 5-minute timeout remains scheduled
- When the worktree truly times out, behavior is unchanged (same error shown, same cleanup)

---

### Validation plan

- Manual:
  - Trigger prompt send in a directory that is already ready; confirm no long timers remain (devtools)
  - Trigger a worktree pending state and confirm:
    - timeout fires at ~5 minutes
    - cleanup runs
