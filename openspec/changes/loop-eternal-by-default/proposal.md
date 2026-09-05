# Make `/loop` relentless by default instead of stopping on completion

## Why

`/backlog` (`/loop --queue`) already solved "never idle while planned work exists": disk-derived
done, quarantine-don't-halt, systemic-failure guard — all shipped in `loop-spec-queue`. Plain
`/loop <prompt>` never got the same treatment, and it is the one people actually reach for first.

The reported symptom: "the CURRENT change may be done, but there is still SHITLOADS of work to be
done" — a plain-mode loop hits `COMPLETE_SIGNAL` (correctly — `loop-completion-contract` works
exactly as specced) and stops, because a single user prompt has no notion of what else is planned.
That is not a bug in completion detection; it is the absence of a "what's next" step after
completion. The same gap applies to `stalled` / `max_reached` exits — a plain loop that stops for
any reason today just... stops, with no attempt to figure out whether stopping was actually right.

Two other loop-spec-queue follow-ups, already on record but never actioned, compound this:
queue ordering is alphabetical by slug rather than priority-aware, and `IterationInfo.toolCalls`
undercounts multi-step turns (only the last assistant message is inspected), which can trip the
prompt-mode no-progress guard on a turn that was actually productive — a second, independent way
a loop can stop when there was still real progress being made.

## What Changes

### 1. On completion, plain `/loop` asks "is there more?" before stopping

When a plain-mode iteration emits the completion token, the loop does not exit immediately.
It runs one disk-derived check — the same eligible-change resolution `loop-spec-queue` already
has (`openspec/changes/`, excluding `archive/`, `_repo/`, and anything holding
`.skein/blocker.md`) — for unchecked-task changes in the current repo. If one exists, the loop
does not stop: it transitions into queue-style continuation, briefed on the next eligible change,
and reports that transition to the user rather than silently mutating what they asked for. If none
exists, it stops exactly as today.

This is the specific, minimal shape of "eternal by default": completion no longer means "the
process ends", it means "check whether the reason for running is actually gone."

### 2. `stalled` / `max_reached` gets a bounded retry with a directive prompt, not an immediate halt

Reuse the adaptive-continuation classification from `fix-loop-reliability` — stall and spin are
already detected and already produce directive prompts. Currently that directive is used within
the no-progress-streak counter, which still terminates the loop once the streak limit is reached.
Add one bounded extra attempt after the streak limit, using the harder-line stall reason
(`"You appear stuck — reassess and either make concrete progress or explain what is blocking you
so this loop can stop honestly"`) before finally halting. This is a one-time reprieve, not an
unbounded retry loop — it must not reintroduce the failure mode `fix-loop-stall` calibrated away.

### 3. `--eternal=false` / a plain "stop" opt-out

Because this changes default behavior for existing `/loop` users, a flag (`--eternal=false` on
the CLI, an equivalent TUI flag) restores today's single-prompt-then-stop behavior. Default is on.

### 4. Fix the two documented `loop-spec-queue` follow-ups

- Priority-aware queue ordering: read a `priority` field (already referenced elsewhere in the
  repo, e.g. `skein_set_priority`) where present on a change, falling back to alphabetical.
- `IterationInfo.toolCalls` counts tool calls across the whole turn, not just the last assistant
  message, so a multi-step turn is never miscounted as a stall.

## Open Design Question — resolved during implementation

How far should plain `/loop` and `/backlog` converge? Implemented as: two entry points stay —
`/loop` is "work this prompt, then check for more"; `/backlog` is "work the whole backlog from
the start" — and the transition is automatic by default (`eternal: true`), not gated behind an
explicit nudge, per the original request's explicit framing ("this should be the default").
`--no-eternal` is the escape hatch for anyone who wants the old stop-on-completion behavior.
Worth a second look in review regardless: an unattended plain loop that silently becomes a
queue run is a bigger behavior change than a bug fix, even though it defaults on.

## Capabilities

### Modified Capabilities
- `loop-service`: post-completion and post-stall continuation logic, `--eternal` flag, priority-aware
  queue ordering, whole-turn tool-call counting.

## Non-Goals

- Not merging `/loop` and `/backlog` into a single command (see Open Design Question).
- Not touching the authority ceiling (`QueueDenyRules`) — an eternal plain loop gets no more
  push/deploy authority than a queue loop has today.
- Not addressing the removed stream-inactivity watchdog (`a90c49880b`) — separate concern, noted
  as a risk for anyone touching unattended-run reliability next.

## Dependencies

- Builds on `loop-spec-queue`, `loop-completion-contract`, `fix-loop-reliability`, `fix-loop-stall`
  (all shipped). No hard dependency on `fleet-instance-presence`, but a more accurate peer/fleet
  roster (see `fleet-instance-presence`) makes the fan-out nudge this loop already emits more
  useful — benefits from it, does not block on it.

## Impact

- Modified: `packages/opencode/src/loop/loop.ts` (completion/stall continuation, `--eternal`),
  `packages/opencode/src/loop/spec-queue/queue.ts` (priority ordering), `packages/opencode/src/loop/continuation.ts`
  (whole-turn tool-call counting), `packages/opencode/src/cli/cmd/loop.ts` and
  `packages/tui/src/component/prompt/index.tsx` (flag surface + transition messaging).
