## Speech recognition timeout cleanup

Stop stray restart timers from keeping recognition alive

---

### Summary

`packages/app/src/utils/speech.ts` schedules 150ms `setTimeout` restarts in `recognition.onerror` and `recognition.onend` when `shouldContinue` is true. These timers are not tracked or cleared, so they can fire after `stop()`/cleanup and call `recognition.start()`, keeping recognition + closures alive unexpectedly.

This spec tracks restart timers explicitly and clears them on stop/cleanup.

---

### Scoped files (parallel-safe)

- `packages/app/src/utils/speech.ts`

---

### Goals

- Ensure no restart timers remain scheduled after `stop()` or `onCleanup`
- Prevent `recognition.start()` from being called after cleanup
- Keep behavior identical in the normal recording flow

---

### Non-goals

- Changing the recognition UX/state machine beyond timer tracking

---

### Proposed approach

- Add `let restartTimer: number | undefined`.
- Add helpers:
  - `clearRestart()`
  - `scheduleRestart()` (guards `shouldContinue` + `recognition`)
- Replace both raw `setTimeout(..., 150)` uses with `window.setTimeout` stored in `restartTimer`.
- Call `clearRestart()` in:
  - `start()`
  - `stop()`
  - `onCleanup(...)`
  - `recognition.onstart` (reset state)
  - any path that exits recording due to error

---

### Implementation steps

1. Introduce `restartTimer` and helpers

2. Replace `setTimeout(() => recognition?.start(), 150)` occurrences

3. Clear the timer in all stop/cleanup paths

---

### Acceptance criteria

- After calling `stop()` or disposing the creator, there are no delayed restarts
- No unexpected `recognition.start()` calls occur after recording is stopped

---

### Validation plan

- Manual:
  - Start/stop recording repeatedly
  - Trigger a `no-speech` error and confirm restarts only happen while recording is active
  - Navigate away/unmount the component using `createSpeechRecognition` and confirm no restarts happen afterward
