# Make session and loop cancellation actually stop work

## Why

A wedged session cannot be stopped by any means the UI offers. Observed on
2026-07-25: session `ses_0691e2d30ffe1mwU1XPH5gr2mQ` (PID 5448, `opencode -s <id>`)
sat blocked for 18h48m. The provider (`z4`, `qwen3.6-35b-a3b-q8-0`) reported
`in_flight: 0, is_processing: false` — it had finished and moved on — while the client
held an ESTABLISHED socket, reading a stream that would never deliver another byte.
Esc did nothing. The log shows 30 `cancel` calls inside 30 milliseconds, then two hours
of silence.

Four defects compound into that state.

**1. `Runner.cancel` flips state to Idle before interruption completes** —
`effect/runner.ts:171-183`. `SynchronizedRef.modify` commits the new state `Idle`
first, *then* runs the returned effect containing `Fiber.interrupt(st.run.fiber)`.
So the first Esc parks forever in `Fiber.interrupt` on the dead socket, and
`idleIfCurrent()` at `runner.ts:180` never runs — meaning `onIdle` never fires and the
session status stays `busy`, so the TUI spinner never clears. Worse, every subsequent
Esc now hits `case "Idle": return [Effect.void, st]` at `runner.ts:173-174` and returns
instantly, doing nothing. **The first Esc disarms the escape hatch.** There is no key
the user can press to escalate. That is precisely the 1-real-plus-29-no-op cancel burst
in the log.

**2. `Fiber.interrupt` has no timeout.** A fiber blocked in an uninterruptible region —
a socket read that never returns — makes cancellation unbounded. Nothing reaps it.

**3. Loop cancel does not abort the in-flight turn.** `loop.ts` contains no call to
`session.abort`, `promptSvc.cancel`, `Fiber.interrupt`, or `Effect.timeout`; `cancel`
and `pause` only mutate a `Ref`. The TUI escape handler happens to call both
`loop.cancel` and `session.abort` (`prompt/index.tsx:454-462`), but the `/loops` dialog
action (`dialog-loop-list.tsx:106-110`) and `opencode loop cancel`
(`cli/cmd/loop.ts:154-165`) call **only** `loop.cancel`. The model turn keeps running to
completion; the loop merely declines to start another iteration.

**4. Cancel is racy and gets overwritten.** After the prompt returns, `run` reaches
`loop.ts:286-299` and calls `finalize(id, …)` unconditionally, and further down for
`stalled` / `max_reached` — none of these re-check that the status is still `running`.
A loop the user cancelled can be reported as `completed`, `stalled`, or `max_reached`
with a rewritten `finishedAt`.

A related hazard: if the session is already `Running`, `runner.ensureRunning`
(`runner.ts:120-122`) joins the existing turn instead of starting one, while the loop's
user message has already been persisted (`prompt.ts:1128`) — so a loop can attribute
another turn's output to its own iteration.

This change is a prerequisite for any unattended loop. An autonomous driver that cannot
be stopped is not shippable.

## What Changes

### 1. Cancellation completes before the state says it did

`Runner.cancel` switches to `SynchronizedRef.modifyEffect` so the transition to `Idle`
is committed only after interruption resolves. A distinct intermediate state
`Cancelling` is introduced so that:
- `busy` still reports true while cancellation is in flight (the spinner stays honest)
- a second cancel while in `Cancelling` **escalates** rather than no-ops

### 2. Bounded interruption with escalation

`Fiber.interrupt` is wrapped in `Effect.timeout`. On expiry the runner:
- force-transitions to `Idle`, fires `onIdle`, and releases the session
- marks the orphaned fiber and logs it at WARN with the session id
- surfaces a TUI notice: the turn was abandoned, not cleanly stopped

A second Esc during `Cancelling` skips the remaining timeout and force-releases
immediately. The user always has a way out.

### 3. A stream watchdog so wedges are detected, not waited on

The provider read path gets an inactivity deadline: if no bytes and no events arrive
for a configurable interval, the stream is torn down and the turn fails with a
distinguishable `StreamStalled` error rather than parking forever. This is what would
have ended the 18-hour hang on its own.

### 4. Loop cancel aborts the running turn

`Loop.cancel` calls `promptSvc.cancel(sessionID)` before flipping status, so all three
entry points (TUI Esc, `/loops` dialog, CLI) behave identically.

### 5. Terminal status is sticky

`finalize` becomes a no-op when the record already holds a terminal status. A cancelled
loop stays `cancelled`.

## Capabilities

### Modified Capabilities
- `loop-service`: cancel aborts in-flight work; terminal status cannot be overwritten.

### New Capabilities
- `session-cancellation`: bounded, escalatable cancellation of a running session turn,
  including recovery from an unresponsive provider stream.

## Non-Goals

- Not reaping the 17.6 GB event-log growth that long wedged sessions produce — separate
  concern, separate change.
- Not adding loop persistence across server restart (still in-memory per
  `loop.ts:138`); a restart already clears a wedge.
- Not changing provider selection or failover behaviour on a stalled stream — this
  change fails the turn cleanly; retry policy is out of scope.

## Impact

- Modified: `packages/opencode/src/effect/runner.ts` (state machine, timeout,
  escalation), `packages/opencode/src/session/run-state.ts`,
  `packages/opencode/src/loop/loop.ts` (abort on cancel, sticky terminal status),
  `packages/opencode/src/cli/cmd/loop.ts`, `packages/tui/src/component/dialog-loop-list.tsx`.
- Provider stream path gains an inactivity deadline (`packages/llm/`).
- `Runner` is shared by every session, not just loops — this touches the core turn
  lifecycle and needs the full session suite green.
