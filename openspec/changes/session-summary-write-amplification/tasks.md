# Tasks: session-summary-write-amplification

## 1. Stop concurrent overlap

- [x] 1.1 `packages/opencode/src/session/summary.ts`: add a per-session
      `Set<SessionID>` reentrancy guard around `summarize()`'s body so a call
      landing while a previous one is still in flight for the same session is
      skipped rather than stacked. Verify: typechecks; a second call issued
      before the first's `Effect.ensuring` cleanup runs returns immediately
      without entering the body.

## 2. Bound steady-state write frequency

- [x] 2.1 Add a `force?: boolean` field to `summarize()`'s input and a
      per-session `Map<SessionID, number>` of last-full-run timestamps. Verify:
      typechecks.
- [x] 2.2 Skip the expensive path (full `computeDiff` + patch text +
      `sessions.updateMessage`) when the last full run for that session was
      under 5s ago and `force` is not set. Move the cheap
      reset/`setSummary`/`Session.Event.Diff` publish so it only runs alongside
      an actual full run — a throttled call must be a pure no-op, not a
      zero-out of the currently displayed diff. Verify: two calls 1s apart for
      the same session produce only one full write; the displayed
      additions/deletions/files do not flicker to zero on the skipped call.
- [x] 2.3 `packages/opencode/src/session/prompt.ts`: at `runLoop`'s
      turn-completion exit (the "no more tool calls" break), call
      `summary.summarize({ sessionID, messageID: lastUser.id, force: true })`
      forked in the background. Verify: a turn whose last few steps landed
      inside the throttle window still ends with an accurate, fully persisted
      diff.

## 3. Connection-level safety net

- [x] 3.1 `packages/core/src/database/sqlite.bun.ts`: set
      `PRAGMA busy_timeout = 5000` on the native connection alongside the
      existing `journal_mode = WAL`. Verify: typechecks; a lock conflict now
      waits up to 5s and fails with a catchable error rather than an unbounded
      stall.

## 4. Verification

- [ ] 4.1 `bun run --cwd packages/opencode typecheck`,
      `bun run --cwd packages/core typecheck` — zero errors.
- [ ] 4.2 `bun test packages/opencode/test/session --timeout 60000` — no new
      failures versus the pre-existing baseline (one known unrelated failure:
      `session.llm.stream > sends Google API payload for Gemini models`, a mock
      HTTP server issue unrelated to this change).
- [ ] 4.3 Manual: run a `build`-agent turn with several fast, tool-only steps
      against a live provider. Confirm via the session DB (`event` table,
      `aggregate_id` = the session) that `message.updated` rows for the
      turn's user message land roughly once per 5s window plus one at turn
      end, not once per step.
