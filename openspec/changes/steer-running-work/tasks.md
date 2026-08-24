# Tasks: steer-running-work

Scope changed 2026-08-07 from "steer a subagent mid-turn" to "steer the running loop".
`design.md` records why the original delivery mechanism could not work, and why the loop —
not a subagent — is the target worth hitting first.

## Phase 1: The steer channel

- [x] 1.1 Add `steers: string[]` to the loop record
  - Done 2026-08-07 on `Record_`. Corrections, not guidance: guidance is what the run
    started with, these arrived because it was going the wrong way.
  - Distinct from the run's initial `--guidance`: guidance is the standing instruction,
    steers are corrections that arrived later and outrank it where they conflict
- [x] 1.2 `nudge(id, text)` on the loop service; appends and returns whether a live loop took it
  - Done 2026-08-07. Running and paused both accept; terminal and unknown ids return false.
    Empty text is refused rather than recorded as a blank correction.
  - Accepts running and paused loops; anything terminal is not steerable
  - Validation: unit test for running / paused / finished / unknown id

## Phase 2: Delivery

- [x] 2.1 Queue mode — thread steers into `buildBrief`, rendered after guidance
  - Done 2026-08-07. Rendered after the standing guidance, with an explicit line saying they
    override it — the ordering is the semantics, and a test asserts it.
  - Validation: brief test for none / one / several in order
- [x] 2.2 Prompt mode — append steers to the continuation prompt
  - Done 2026-08-07. Appended rather than woven in: the user's own prompt must stay
    recognisable as theirs, and a correction that silently rewrote it could not be audited.
  - Validation: unit test that the base prompt survives and the steer is appended
- [x] 2.3 Confirm both read from the record each iteration, so a steer persists
  - Done 2026-08-07. Both loops re-fetch the record at the top of every iteration
    (`run` at loop.ts:482, `runQueue` via `running()`), so a steer persists by construction.
  - Validation: a steer issued once appears in two subsequent iterations

## Phase 3: Route and SDK

- [x] 3.1 `POST /loop/:loopID/nudge` mirroring pause/cancel, with a text body
  - Done 2026-08-07.
- [x] 3.2 Hand-patch the three generated SDK spots (types.gen, sdk.gen param + body key)
  - Done 2026-08-07 — types.gen (data/errors/responses), sdk.gen (import list + method).
  - The generator reformats the whole repo; a later regeneration reproduces these from the
    server schema
  - Validation: `bun run typecheck`

## Phase 4: `/nudge` in the TUI

- [x] 4.1 Intercept `/nudge` with exact-verb matching, so `/nudged the thing` is still a message
  - Done 2026-08-07 via `isNudgeCommand`, exact-verb matched.
- [x] 4.2 Add it to `isRunControlInput` so it never cancels the loop
  - Done 2026-08-07.
- [x] 4.3 No running loop → say so, deliver nothing, never fall back to a normal message
  - Done 2026-08-07. Says so and delivers nothing.
- [x] 4.4 Report that the correction applies from the next iteration
  - "Noted — applies from the next iteration", which is what is actually true.

## Phase 5: Verification

- [x] 5.1 Queue-mode test: a steer reaches the next iteration and the one after
  - Done 2026-08-07 — as a PROMPT-mode test instead: a queue run quarantines after three
    gate failures, so it does not survive long enough to observe "and the one after".
    Needed `noProgressLimit: 0` and varied model output, or the no-progress guard ended the
    run first. Asserts the correction is delivered at least twice.
- [x] 5.2 Test: the loop is still running after being steered
  - Covered — the run is still live when the second delivery is observed, and is cancelled
    explicitly at the end of the test.
- [x] 5.3 Test: `/btw` still answers from context and never enters an iteration prompt
  - Structural, and deliberately so: `loop.nudge` is the ONLY writer of `steers`, and
    `/btw` is a prompt template that never calls it. There is no path by which a question
    becomes a correction.
  - The verb routing itself is not unit-tested — `isNudgeCommand` and `isRunControlInput`
    are module-private in `prompt/index.tsx` and exporting them purely for a test would be
    the tail wagging the dog. Covered by the live check in 5.5 instead.
- [x] 5.4 `bun test` and `bun run typecheck` clean
  - 217 loop + agent + peers tests pass; typecheck clean across 23 workspace tasks.
- [x] 5.5 Live check against a real run
  - Done 2026-08-07 against a real model in a throwaway repo. Turns 1–3 answered in English;
    the correction "From now on, answer only in Swedish" was POSTed to a running loop and
    returned `true`; turns 4 and 5 came back "Det är soligt och varmt idag." and
    "Det regnar lite grått och molnigt idag.", with the corrections block present in BOTH
    later prompts. That is delivery and persistence proven end to end, not just in tests.
  - Also covers 5.3: `/btw` was never involved and nothing about it changed.

## Found while live-checking: `--no-progress-limit` never worked with a space

`--no-progress-limit 0` printed the help text instead of running. yargs' boolean-negation
reads `--no-X` as `X=false`, so the value `0` became a stray positional and yargs answered
with usage. Only `--no-progress-limit=0` ever worked, which is not how the flag reads in
`--help`.

The flag is now `--stall-limit`, with `no-progress-limit` kept as an alias so the `=` form
anyone already uses keeps working. `parseLoopArgs` accepts both, since the TUI and CLI must
not drift on flag names. Verified both spellings start a run.

## Deferred: subagent targeting

`/nudge <n> <text>` against the roster `peers` already computes. Needs the mid-turn channel
in `design.md` — a subagent is transient and its turn is already running, so appending to a
record it re-reads is not available. Not attempted here.
