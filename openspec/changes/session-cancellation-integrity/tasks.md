# Tasks: session-cancellation-integrity

## Phase 1: Runner state machine (core — touches every session)

- [ ] 1.1 Add a `Cancelling` state to `Runner.State`
  - `effect/runner.ts:29-33`: add `{ _tag: "Cancelling"; run: RunHandle<A,E>; escalate: Deferred.Deferred<void> }`
  - `busy` getter (`runner.ts:208-210`) reports true for `Cancelling`
  - Validation: `bun typecheck` in packages/opencode — zero errors

- [ ] 1.2 Convert `cancel` from `modify` to `modifyEffect` so `Idle` is committed after interruption
  - `runner.ts:171-202`: transition `Running → Cancelling`, run interruption, then commit `Idle`
  - Ensure `idleIfCurrent()` is reached on every exit path, including timeout
  - Validation: `bun typecheck` passes

- [ ] 1.3 Make a cancel arriving in `Cancelling` escalate
  - Resolve the stored `escalate` Deferred instead of returning `Effect.void`
  - Validation: unit test — two sequential cancels on a stuck fiber release the session

- [ ] 1.4 Bound interruption with `Effect.timeout` + race against `escalate`
  - On expiry or escalation: force `Idle`, fire `onIdle`, log WARN with session id
  - Validation: unit test with a deliberately uninterruptible fiber — `cancel` returns within the timeout

- [ ] 1.5 Regression-test the exact observed failure
  - Test: fiber blocked on a never-resolving read; issue 30 cancels in a tight loop
  - Assert: session ends idle, and no cancel returned as a no-op while the turn was alive
  - Validation: new test passes

## Phase 2: Stream watchdog

- [ ] 2.1 Add an inactivity deadline to the provider stream read path
  - Reset on every byte/event; on expiry tear down and fail with a `StreamStalled` error
  - Default deadline configurable; must not fire on slow-but-live streams
  - Validation: `bun typecheck` passes

- [ ] 2.2 Map `StreamStalled` to an assistant message error distinct from `AbortedError`
  - Validation: TUI shows a stalled-stream message, not a generic abort

- [ ] 2.3 Tests for both directions
  - Test: half-open stream (no data after headers) → fails within deadline
  - Test: stream with gaps just under the deadline → completes normally
  - Validation: `bun test packages/llm --timeout 30000` — all pass

## Phase 3: Loop cancel aborts real work

- [ ] 3.1 `Loop.cancel` calls `promptSvc.cancel(record.info.sessionID)` before flipping status
  - `loop.ts:423-439`
  - Validation: `bun typecheck` passes

- [ ] 3.2 Route the `/loops` dialog cancel through the same path
  - `packages/tui/src/component/dialog-loop-list.tsx:106-110` — currently loop-only
  - Validation: manual — dialog cancel stops an in-flight turn

- [ ] 3.3 Route `opencode loop cancel` through the same path
  - `cli/cmd/loop.ts:154-165` — currently loop-only
  - Validation: manual — CLI cancel stops an in-flight turn

## Phase 4: Sticky terminal status

- [ ] 4.1 Guard `finalize` against overwriting a terminal status
  - `loop.ts:286-326`: return early if `record.info.status` is already terminal; do not rewrite `finishedAt`
  - Validation: `bun typecheck` passes

- [ ] 4.2 Test the cancel-then-late-completion race
  - Test: cancel mid-iteration, then have the mock LLM return the completion token
  - Assert: status stays `cancelled`, `finishedAt` unchanged
  - Validation: new test passes

- [ ] 4.3 Test cancel racing stall and cap detection
  - Validation: status stays `cancelled` in both cases

## Phase 5: Foreign-turn guard

- [ ] 5.1 Skip an iteration when the target session already has a running turn
  - Check before dispatch; record the iteration as skipped rather than joining via `ensureRunning` (`runner.ts:120-122`)
  - Validation: `bun typecheck` passes; test asserts no foreign output is attributed

## Phase 6: Verification

- [ ] 6.1 Full session suite green — `Runner` is shared by every session
  - Validation: `bun test test/session/ --timeout 60000` — all pass

- [ ] 6.2 Full loop suite green
  - Validation: `bun test test/loop/ --timeout 30000` — all pass

- [ ] 6.3 Manual wedge reproduction
  - Point a session at a provider, kill the upstream mid-stream to leave a half-open socket
  - Assert: watchdog ends the turn; if not, one Esc cancels and a second escalates
  - Validation: session recovers without killing the process

- [ ] 6.4 Full typecheck and build
  - Validation: `bun typecheck` zero errors; `bun run packages/opencode/script/build.ts --single` smoke-passes
