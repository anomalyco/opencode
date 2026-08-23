# Session Reliability Roadmap

Improvements surfaced by the 2026-08-23 investigation into mid-stream cutoffs
(see PR #44529 for the shipped watchdog/queue work). Ordered by value; items 1-2
are in flight, the rest are candidates.

## Context

Three failure classes were identified when users reported "OpenRouter keeps
stopping halfway through":

1. Zombie streams — fixed by on-by-default `headerTimeout`/`chunkTimeout` (PR #44529).
2. Host machine crashes mid-turn — outside opencode's control, but opencode can recover more gracefully (item 2).
3. Provider emitting premature clean stops — model behavior, but detectable (item 3).

## 1. finishReason observability — IN PROGRESS

**Problem:** the CLI log never records why a stream ended. Diagnosing cutoffs
required querying the SQLite DB directly for `message.finish` values.

**Fix:** log reason + usage at each step finish in the session processor
(`packages/opencode/src/session/processor.ts`, step-finish branch of
`handleEvent`). One INFO line per provider turn:
`step-finish { session.id, messageID, reason, tokens.output }`.

## 2. Stale-busy recovery on boot — IN PROGRESS

**Problem:** when the process dies mid-turn, assistant message rows are left
with no `finish`, no `error`, and no `time.completed` forever. Sessions reopen
showing turns that "never finished", and there is no record of what happened.

**Fix:** at instance start, sweep assistant messages that have no
`time.completed` and whose `time_updated` predates this boot, and finalize them
with an interrupted error (`MessageAbortedError`, aborted: true) plus a
completed timestamp. Guard: only messages older than process start, so live
turns from concurrently running instances are untouched.

## 3. Auto-resume on truncated stop

**Problem:** providers occasionally emit a premature `finish_reason: stop`
(observed: ~144 final steps averaging ~500 output tokens). opencode honors the
stop unconditionally and goes idle mid-task.

**Approach:** heuristic gate — finish=stop with low output tokens while tool
work is pending → surface a "resume" affordance (or auto-continue once).
Loop-risk: must not fight agents that legitimately stop early. Needs a
config flag, default off, until heuristics prove out.

## 4. Snapshot warning spam

**Problem:** ~90 WARN/day of `failed to list snapshot files` (`fatal: not a git
repository`) against a stale snapshot directory drown real signal in logs.

**Fix:** cache the failure per snapshot dir, or demote to debug after first
occurrence.

## 5. Surface effective provider settings

**Problem:** stream watchdogs existed for months but were effectively secret.
Users should not have to read source to learn active timeouts.

**Fix:** a diagnostic command (`opencode doctor` or extend an existing status
surface) listing resolved per-provider options: headerTimeout, chunkTimeout,
baseURL, auth source.

## 6. Post-crash turn continuation

**Problem:** a turn killed by process death cannot resume; admitted-but-unrun
provider work is lost. The V2 core notes reserve this for explicit design
("post-crash continuation recovery requires a separate explicit design before it
may retry provider work").

**Approach:** durable continuation markers on the last step-finish snapshot;
on boot with user opt-in, re-issue the provider turn from the projected history.
Depends on V2 runner semantics; design doc required before implementation.

## 7. Queue persistence

**Problem:** prompts queued client-side die with the process.

**Approach:** persist queued prompts as durable pending inputs (V2 already has
`session_input` rows); drain on next launch. Pairs naturally with item 6.
