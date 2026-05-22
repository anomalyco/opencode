# Feature: retry-exhausted-recovery
> Created: 2026-05-22 | Status: DONE | Complexity: Standard

## Design

When network errors exhaust the 3-retry budget, sessions currently silently halt with status `idle` and an error on the assistant message. The user has no visibility into what happened and must manually type "continue". This feature changes that:

1. Add a new session status `retry_exhausted` alongside `idle`, `busy`, `retry`. When `halt()` is called and the error is a retryable network error that exhausted all retries, set status to `{ type: "retry_exhausted", attempt: 3, message: "Network error: ...", error: ... }` instead of `{ type: "idle" }`.

2. Emit a `Session.Event.RetryExhausted` event on the bus (same pattern as existing `Session.Event.Retried` and `Session.Event.Error` events). This lets SSE subscribers know the session is in a recoverable state.

3. The TUI renders `retry_exhausted` status with a clear "Network error — press Enter to retry" action. On Enter, the session re-prompts using the original user message (preserved in conversation history). On Escape, dismiss the error and return to idle.

Subagents inherit recovery naturally through the parent: subagent errors propagate as tool call failures to the parent, and the parent's retry_exhausted state lets the user retry the entire task.

## Tasks

### TASK-1: Add retry_exhausted status type and processor logic
- Status: completed
- Depends on: none
- Files: `packages/opencode/src/session/status.ts`, `packages/opencode/src/session/processor.ts`, `packages/opencode/src/session/run-state.ts`, `packages/opencode/src/session/compaction.ts`, `packages/opencode/test/session/retry.test.ts`
- Acceptance: ✅ All met
  - `status.set()` accepts `retry_exhausted` type with all fields
  - Processor sets `retry_exhausted` (not `idle`) when error is retryable and retries exhausted
  - Processor sets `idle` for non-retryable errors (no change in existing behavior)
  - `retry_exhausted` status transitions to `busy` on next prompt via `ensureRunning()`
  - All existing tests pass (364 pass, 0 fail)
- Checkpoint: Added `retry_exhausted` to Info union in status.ts, processor.ts detects retryable errors after retry exhaustion, compaction.ts and run-state.ts handle the new status type

### TASK-2: Emit RetryExhausted event on the bus
- Status: completed
- Depends on: TASK-1
- Files: `packages/core/src/session-event.ts`, `packages/opencode/src/session/processor.ts`, `packages/opencode/src/session/session.ts`, `packages/core/src/session-message-updater.ts`
- Acceptance: ✅ All met
  - `RetryExhausted` event type exists in session-event schema with proper fields
  - Processor emits `RetryExhausted` event when setting `retry_exhausted` status
  - SSE event endpoint forwards `RetryExhausted` events to connected clients (via existing subscribeAll)
  - All existing tests pass (364 pass, 0 fail)
- Checkpoint: Added RetryExhausted event to session-event.ts, session.ts, and processor emits it via bus.publish and events.publish (dual-write pattern)

### TASK-3: TUI renders retry_exhausted with Retry action
- Status: completed
- Depends on: TASK-2
- Files: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- Acceptance: ✅ All met
  - TUI shows distinct UI for `retry_exhausted` status with error message and attempt number
  - Enter key re-sends last user message text parts via sdk.client.session.prompt and transitions to `busy`
  - Escape key dismisses the error and sets status to `idle` (bypasses interrupt/abort)
  - All existing tests pass
- Checkpoint: Added retry_exhausted rendering (Match block at line 1620), Enter handler in submitInner(), Escape handler in session.interrupt run()

## Summary

All 3 tasks completed. The feature adds a 3-layer retry recovery system:
1. **L1: Auto-retry** — Network errors are now retryable with 3 attempts (2s→4s→8s backoff)
2. **L2: Clear error state** — `retry_exhausted` status shows what happened, with `RetryExhausted` event on bus
3. **L3: User-controlled retry** — Enter resends last user message, Escape dismisses error

Branch: `fix/retry-network-errors` on fork `OrShmuel22/opencode`
Commits: 3 (network retry + retry_exhausted status + TUI wiring)
Tests: 364 session tests pass, 49 retry tests pass, 0 failures
Typecheck: Clean

## Event Log
> 2026-05-22 DESIGN_APPROVED: User approved 3-task design for retry_exhausted recovery feature
> 2026-05-22 SPAWN: TASK-1 editor started
> 2026-05-22 COMPLETE: TASK-1 editor finished — retry_exhausted status type added
> 2026-05-22 VERIFY: TASK-1 passed — 364 tests, typecheck clean
> 2026-05-22 SPAWN: TASK-2 editor started  
> 2026-05-22 COMPLETE: TASK-2 editor finished — RetryExhausted event added
> 2026-05-22 VERIFY: TASK-2 passed — 364 tests, typecheck clean
> 2026-05-22 SPAWN: TASK-3 editor started
> 2026-05-22 COMPLETE: TASK-3 editor finished — TUI Enter/Escape wired
> 2026-05-22 VERIFY: TASK-3 passed — 364 tests, typecheck clean
> 2026-05-22 DONE: All tasks completed
