# Investigate and fix background-subagent delegation and wake-up reliability

## Why

Two related but distinct reports about subagents:

1. Suggested delegation targets are often unusable (root-caused to `fleet-instance-presence`
   Phases 3-4 being unbuilt — see that change's Phase 6 and Addendum). Out of scope here.
2. **Even when delegation does happen, the parent doesn't reliably keep working and get woken by
   the result.** `subagent-background-default` (5/6 done, merged `cb42c93c`) made
   `background: true` the default so a placed subagent returns a placeholder immediately and the
   parent continues; the result is later injected as a synthetic message. The reported behavior is
   that this doesn't hold in practice — the parent ends up idling, as if waiting synchronously
   anyway. `subagent-background-default` task 6 ("verify in a real fleet run") was never checked
   off; nobody has confirmed the wake-up path actually works end to end.

This is a real, previously-unverified gap, not a duplicate of the roster-accuracy problem above.
A perfectly accurate roster does not help if the notification path that is supposed to resume the
parent's turn silently does nothing.

## What Changes

### 1. Root-cause the wake-up path

Before writing any fix, trace one concrete case end to end: `task.ts` places a background
subagent → child session runs → child completes → result is supposed to reach the parent as a
synthetic message that resumes its turn. Instrument or log each handoff point and reproduce the
"parent idles" symptom deliberately (a background subagent placed on a host or peer expected to
take noticeably longer than the parent's own turn). Identify which of the following it actually is:

- The synthetic-message injection never fires (a bug in the completion→injection wiring).
- It fires, but the parent session is not in a state that resumes on injection (needs an active
  turn / event loop wake, and doesn't get one).
- It fires correctly, but only once the parent happens to send another message or poll — i.e. the
  parent is not actually "notified", it is quietly queued and picked up on the next unrelated
  turn, which looks identical to idling from the outside.
- The background subagent itself errored or hung, and what looks like "no notification" is
  correctly "no result to notify with" — a placement/liveness problem, not a notification bug
  (route this case to `fleet-instance-presence` Phase 6 instead of fixing it here).

### 2. Fix whichever of the above is confirmed

Scope deliberately left open until root cause is known — do not pre-commit to a fix shape. The
fix must preserve `subagent-background-default`'s existing guarantee (background is the default,
opt-out via `background: false`) and must not turn a busy/errored subagent into a parent hang: a
child that errors or times out should notify the parent of the failure, not leave it waiting
indefinitely.

### 3. Never let delegation become a black hole

Independent of root cause: add an explicit ceiling — if a background subagent has not completed
or reported progress within a bounded window, the parent is notified of that fact (not left
inferring it from silence), consistent with `ctx-aware-subagent-placement` task 5's wall-clock
ceiling for local placement, extended here to cover the notification path generically regardless
of where the subagent is placed.

## Non-Goals

- Not re-solving roster accuracy — that's `fleet-instance-presence` Phase 6.
- Not building the free-model-provider pool — that's `free-model-subagent-pool`, which depends on
  the notification path being trustworthy before adding a third, less-reliable placement target.
- Not changing the authority/permission boundary around subagents.

## Dependencies

- Benefits from `fleet-instance-presence` Phase 6 to rule out "stale roster" as a confound, but can
  start independently by reproducing the symptom with a known-good local target.
- `free-model-subagent-pool` depends on this change: delegating to a cloud "free" model that may
  be slow, rate-limited, or silently unavailable makes a broken wake-up path far more damaging
  (exactly the "delegates work it could have done itself, then idles forever" failure the request
  called out).

## Impact

- Investigation touches `packages/opencode/src/tool/task.ts` (placement/injection call sites),
  the session synthetic-message path (`session.synthetic` / equivalent), and
  `packages/opencode/src/session/processor.ts` (turn scheduling/wake semantics).
- Fix location depends on root cause (Slice 1); tasks.md Slice 2 is intentionally conditional.
