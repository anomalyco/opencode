## Terminal unmount race cleanup

Prevent Ghostty Terminal/WebSocket leaks when unmounting mid-init

---

### Summary

`packages/app/src/components/terminal.tsx` initializes Ghostty in `onMount` via async steps (`import("ghostty-web")`, `Ghostty.load()`, WebSocket creation, terminal creation, listeners). If the component unmounts while awaits are pending, `onCleanup` runs before `ws`/`term` exist. The async init can then continue and create resources that never get disposed.

This spec makes initialization abortable and ensures resources created after unmount are immediately cleaned up.

---

### Scoped files (parallel-safe)

- `packages/app/src/components/terminal.tsx`

---

### Goals

- Never leave a WebSocket open after the terminal component unmounts
- Never leave window/container/textarea event listeners attached after unmount
- Avoid creating terminal resources if `disposed` is already true

---

### Non-goals

- Reworking terminal buffering/persistence format
- Changing PTY server protocol

---

### Current state

- `disposed` is checked in some WebSocket event handlers, but not during async init.
- `onCleanup` closes/disposes only the resources already assigned at cleanup time.

---

### Proposed approach

1. Guard async init steps

- After each `await`, check `disposed` and return early.

2. Register cleanups as resources are created

- Maintain an array of cleanup callbacks (`cleanups: VoidFunction[]`).
- When creating `socket`, `term`, adding event listeners, etc., push the corresponding cleanup.
- In `onCleanup`, run all registered cleanups exactly once.

3. Avoid mutating shared vars until safe

- Prefer local variables inside `run()` and assign to outer `ws`/`term` only after confirming not disposed.

---

### Implementation steps

1. Add `const cleanups: VoidFunction[] = []` and `const cleanup = () => { ... }` in component scope

2. In `onCleanup`, set `disposed = true` and call `cleanup()`

3. In `run()`:

- `await import(...)` -> if disposed return
- `await Ghostty.load()` -> if disposed return
- create WebSocket -> if disposed, close it and return
- create Terminal -> if disposed, dispose + close socket and return
- when adding listeners, register removers in `cleanups`

4. Ensure `cleanup()` is idempotent

---

### Acceptance criteria

- Rapidly mounting/unmounting terminal components does not leave open WebSockets
- No `resize` listeners remain after unmount
- No errors are thrown if unmount occurs mid-initialization

---

### Validation plan

- Manual:
  - Open a session and rapidly switch sessions/tabs to force terminal unmount/mount
  - Verify via devtools that no orphan WebSocket connections remain
  - Verify that terminal continues to work normally when kept mounted
