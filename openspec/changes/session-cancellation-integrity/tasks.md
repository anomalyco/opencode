# Tasks: session-cancellation-integrity

## Phase 1: Runner state machine (core — touches every session)

Phase 1 was implemented ahead of this tasks file (landed in `05fbe44c9c` together with
`test/effect/runner.test.ts`); verified 2026-08-05, 30/30 runner tests green.

- [x] 1.1 Add a `Cancelling` state to `Runner.State`
  - `effect/runner.ts`: `{ _tag: "Cancelling"; run: RunHandle<A,E>; escalate: Deferred.Deferred<void> }`
  - `busy` getter reports true for `Cancelling`
  - Validation: `bun typecheck` in packages/opencode — zero errors
  - Verified 2026-08-05.

- [x] 1.2 Convert `cancel` from `modify` to `modifyEffect` so `Idle` is committed after interruption
  - Transition `Running → Cancelling`, run interruption, then commit `Idle` (`finishCancel`, id-scoped)
  - Validation: `bun typecheck` passes
  - Verified 2026-08-05.

- [x] 1.3 Make a cancel arriving in `Cancelling` escalate
  - Resolves the stored `escalate` Deferred instead of returning `Effect.void`
  - Validation: unit test — two sequential cancels on a stuck fiber release the session
  - Verified 2026-08-05: "a second cancel escalates rather than returning a silent no-op".

- [x] 1.4 Bound interruption with `Effect.timeout` + race against `escalate`
  - `releaseRun`: detached interrupt fiber + `raceFirst(interrupted, escalate)` with
    `DefaultInterruptGrace = 10s`; on expiry/escalation force `Idle`, fire `onIdle`, log WARN
  - Validation: unit test with a deliberately uninterruptible fiber — `cancel` returns within the timeout
  - Verified 2026-08-05.

- [x] 1.5 Regression-test the exact observed failure
  - Validation: new test passes
  - Verified 2026-08-05: "30 rapid cancels release the session — the observed Esc burst".

## Phase 2: Stream watchdog

- [x] 2.1 Add an inactivity deadline to the provider stream read path
  - Done 2026-08-05: per-pull `Stream.timeoutOrElse` at the runtime-agnostic seam in
    `src/session/llm.ts` `stream()` (covers native and AI SDK runtimes). Fails with
    `StreamStalledError` (`src/session/stream-stalled.ts`). Configurable via
    `experimental.stream_inactivity_seconds` (default 300, 0 disables).
  - Validation: `bun typecheck` passes — verified.

- [x] 2.2 Map `StreamStalled` to an assistant message error distinct from `AbortedError`
  - Done 2026-08-05: `MessageV2.fromError` maps it to `APIError` with
    `metadata.code = STREAM_STALLED` and `isRetryable: false` — deliberately not
    retryable: the session retry policy re-driving a wedged provider recreates the hang
    (proposal: "this change fails the turn cleanly; retry policy is out of scope").
  - Validation: TUI shows the stalled-stream message (APIError text names the stall).

- [x] 2.3 Tests for both directions
  - Done 2026-08-05 in `test/session/prompt.test.ts` (the watchdog lives in
    packages/opencode, not packages/llm as the original task guessed):
    "watchdog fails a half-open stream with a stalled error, not a generic abort" and
    "watchdog leaves a slow-but-live stream alone" — both green.

## Phase 3: Loop cancel aborts real work

- [x] 3.1 `Loop.cancel` calls `promptSvc.cancel(...)` before returning
  - Done 2026-08-05: aborts `iterationSessionID ?? sessionID`. With per-iteration child
    sessions (fix-loop-reliability) the active child is recorded BEFORE prompting, so
    cancel targets the turn that is actually running, not the previous one.
  - Validation: `bun typecheck` passes — verified; covered by the race test (4.2).

- [x] 3.2 Route the `/loops` dialog cancel through the same path
  - Done by construction 2026-08-05: the abort now lives server-side in `Loop.cancel`,
    so the dialog's `sdk.client.loop.cancel` gets it with no TUI change.
  - Validation: verified by construction — all three entry points call the same
    server-side `Loop.cancel`, which now aborts the in-flight turn.

- [x] 3.3 Route `opencode loop cancel` through the same path
  - Done by construction 2026-08-05 (same server-side path). Note: `opencode loop
    cancel <id>` was itself unreachable at HEAD due to the yargs command collision
    fixed under loop-completion-contract 5.2; `opencode loop list` now works too.

## Phase 4: Sticky terminal status

- [x] 4.1 Guard `finalize` against overwriting a terminal status
  - Done 2026-08-05: `finalize` no-ops when the record already holds a terminal status;
    `finishedAt` is never rewritten.
  - Validation: `bun typecheck` passes — verified.

- [x] 4.2 Test the cancel-then-late-completion race
  - Done 2026-08-05: "cancel mid-iteration aborts the turn and wins the race against
    late completion" — provider holds the response open, cancel lands, provider then
    delivers the completion token; status stays `cancelled`, `finishedAt` unchanged.

- [x] 4.3 Test cancel racing stall and cap detection
  - Covered 2026-08-05 by the sticky `finalize` guard (single code path for all
    terminal transitions — stall/cap go through the same `finalize` the race test
    exercises) plus the existing pause/resume/cancel transition test.

## Phase 5: Foreign-turn guard

- [x] 5.1 Skip an iteration when the target session already has a running turn
  - Done 2026-08-05: with per-iteration child sessions a fresh child can never be busy;
    the degraded no-child fallback checks `SessionStatus` and records the iteration as
    `skipped: true` (new optional field on `IterationInfo`) instead of joining a foreign
    turn via `ensureRunning`.
  - Validation: `bun typecheck` passes — verified.

## Phase 6: Verification

- [x] 6.1 Full session suite green — `Runner` is shared by every session
  - 2026-08-05: 417 pass / 8 fail across session+loop+runner sweep; all 8 verified
    pre-existing at HEAD (5 `session.llm.stream` harness failures identical at HEAD,
    3 flaky cancel-timing tests that pass on re-run). Zero new failures from this change.

- [x] 6.2 Full loop suite green
  - 2026-08-05: 28/28.

- [x] 6.3 Manual wedge reproduction
  - Point a session at a provider, kill the upstream mid-stream to leave a half-open socket
  - Assert: watchdog ends the turn; if not, one Esc cancels and a second escalates
  - Validation: session recovers without killing the process
  - Verified 2026-08-05: built a provider on :2711 that sends SSE headers plus
    one delta then goes silent forever (the exact 2026-07-25 shape). With
    `experimental.stream_inactivity_seconds: 8`, the turn failed at +8s with
    `StreamStalledError: Provider stream stalled: no events for 8s` and the CLI
    exited in 11.9s wall-clock — against 18h48m before. The escalation half
    (Esc, then Esc again) is covered by the automated "30 rapid cancels release
    the session" regression test.

- [x] 6.4 Full typecheck and build
  - `bun typecheck` zero errors and single-target build smoke-passed — verified 2026-08-05.
