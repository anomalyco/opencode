# Bound session-summary write amplification

## Why

Live incident, 2026-07-26: every opencode-skein process on this machine — across
every project directory, since the session store is one SQLite file per build
channel shared by all of them — hung with zero forward progress and no surfaced
error. Four processes were pegged at 128-170% CPU for hours (one since the
previous Friday).

Root cause, traced to source: `packages/opencode/src/session/processor.ts:744-749`
calls `SessionSummary.summarize()` on **every agent step**, not once per turn.
`summarize()` (`packages/opencode/src/session/summary.ts`) recomputes the full
diff of every file changed so far in the turn — including unified-diff patch
text via `snapshot.diffFull` — writes it into the triggering user message's
`summary.diffs` field, and calls `sessions.updateMessage()`. The session store is
event-sourced (`packages/core/src/database/sqlite.bun.ts`, `event` table): every
`updateMessage` call publishes the *entire* message document as a new, permanent
row. Nothing ever supersedes or prunes a prior snapshot of the same message.

Measured live against the running fleet's shared DB: one session had 12,881
`message.updated` rows totaling 1.6 GB, the single largest row 20 MB — one user
message, republished in full on every step of every turn it was ever part of.
The event table alone accounted for roughly 10 GB of a 17 GB database file.

With `PRAGMA busy_timeout` unset (defaults to 0 — a lock conflict fails
immediately rather than waiting), five opencode processes contending for that one
file turned into sustained CPU-pegged threads parked in kernel lock/condvar waits
with no error ever reaching the user. Only local-provider sessions were affected;
the one cloud-provider session in the same incident kept working throughout,
which is consistent with local (`build`-agent, tool-heavy) sessions driving far
more steps — and therefore far more `summarize()` calls — per turn.

## What Changes

1. **`busy_timeout = 5000`** on the shared SQLite connection
   (`packages/core/src/database/sqlite.bun.ts`). A lock conflict now waits up to
   5s and surfaces a real error instead of an unbounded silent stall. *(Already
   applied.)*
2. **Per-session reentrancy guard on `summarize()`**
   (`packages/opencode/src/session/summary.ts`): a step whose call lands while a
   previous one for the same session is still computing/persisting is skipped
   rather than stacking up. This is the direct fix for the observed failure mode
   — fast bursts of steps causing concurrent full-repo-diff computations and
   writes to pile up and thrash the shared DB. *(Already applied.)*
3. **Throttle the expensive path to once per 5s per session, even
   single-threaded** (`packages/opencode/src/session/summary.ts`): the cheap
   reset (`additions`/`deletions`/`files` counters, small session-level event)
   still only fires when a full run is about to happen — no more resetting the
   displayed diff to zero and leaving it there through a skipped call. The
   expensive part (full `computeDiff` + patch text + `updateMessage`) is skipped
   if the last full run for that session was under 5s ago. This bounds a long
   turn's write volume by wall-clock time, not step count. *(Already applied.)*
4. **Guaranteed final call at turn completion**
   (`packages/opencode/src/session/prompt.ts`, `runLoop`'s primary exit at the
   "no more tool calls" break): `summarize()` gains a `force` flag that bypasses
   the throttle (never the reentrancy guard). The turn-completion exit calls it
   with `force: true`, so the persisted diff is never left stale by a throttled
   intermediate step. *(Already applied.)*

## Non-Goals

- **No pruning or compaction of historical `message.updated` event rows.**
  `revert.ts` and session history plausibly depend on the event log being
  complete; changing that is a distinct, higher-risk architectural change and
  needs its own design and review — not bundled into an incident fix. The 17 GB
  file existing today is not reduced by this change.
- **No `VACUUM` of the existing database.** Reclaiming the on-disk space needs
  ~17 GB of free temp disk and every opencode process stopped for the duration.
  Operational, not code — a separate, explicitly-approved step.
- **No change to the compaction-triggered loop exit**
  (`packages/opencode/src/session/prompt.ts`, the `result === "stop"` break from
  `compaction.process`). That path is a rarer, already-anomalous exit; the next
  normal turn completion (or the 5s throttle window) still catches up the diff
  for it, at the same bounded staleness risk already accepted for any throttled
  intermediate step.
- **No change to the `event`/`message`/`part` schema or to what data is
  considered worth persisting** — only to *how often* the expensive persist runs.

## Impact

- `packages/core/src/database/sqlite.bun.ts` — `busy_timeout` PRAGMA.
- `packages/opencode/src/session/summary.ts` — reentrancy guard, throttle,
  `force` flag.
- `packages/opencode/src/session/prompt.ts` — forced final `summarize()` call at
  turn-completion exit.
- No API, schema, or on-disk format changes. No migration.
