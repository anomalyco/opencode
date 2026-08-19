# Tasks: fix-loop-reliability

## Phase 1: Per-iteration child sessions

- [x] 1.1 Change `runIteration` to create a child session for each iteration
  - `loop.ts`: call `session.create({ parentID: loopSessionID, title: \`loop iter ${n}: ${promptHead}\` })`instead of reusing`record.info.sessionID`
  - Pass the child `sessionID` to `promptSvc.prompt()`
  - Add `iterationSessionID?: SessionID` to `Info` schema (optional, set after each iteration)
  - Validation: `bun typecheck` in packages/opencode — no errors
  - Done 2026-08-05. Child creation failure falls back to prompting the loop
    session directly (degraded iteration beats dead loop).

- [x] 1.2 Update `patch` call after `runIteration` to store `iterationSessionID`
  - Validation: `bun typecheck` passes; running a loop creates child sessions visible in TUI session list
  - Done 2026-08-05.

- [x] 1.3 Add `iterationSessionID` to `Info` schema and `CreateInput` (optional read-only)
  - `loop.ts`: extend `Info` struct; keep backward-compatible (optional field)
  - Validation: `bun typecheck` passes; SDK types reflect the new field
  - Done 2026-08-05: added to `Info` (not `CreateInput` — it is loop-owned output,
    never caller input). SDK regeneration pending (`bun run --filter @opencode-ai/sdk generate`
    or repo equivalent) — the server accepts/emits it already.

- [x] 1.4 Confirm `session.create({ parentID })` correctly limits inner step count
  - Child sessions have `parentID` set → `defaultSteps = DefaultSubAgentSteps = 50` applies
  - Validation: check `prompt.ts` logic — `session.parentID ? DefaultSubAgentSteps : Infinity`
  - Verified 2026-08-05 (`prompt.ts` ~1290). Note: loop iterations therefore now run
    under the 50-step sub-agent cap — a bounded iteration is the desired behavior.

## Phase 2: Adaptive continuation prompt

- [x] 2.1 Add `PreviousOutcome` type capturing the signals needed for prompt selection
  - Fields: `toolCalls: number`, `outputLength: number`, `wasNearIdentical: boolean`
  - Done 2026-08-05: lives in `src/loop/continuation.ts` (import-free, same pattern
    as `completion.ts`/`similarity.ts`), re-exported from `loop.ts`.

- [x] 2.2 Implement `continuationPrompt(base: string, prev: PreviousOutcome | undefined): string`
  - First iteration (`prev === undefined`): return `base`
  - Stall (zero tool calls, short output ≤ 50 chars): prepend directive about executing the plan
  - Empty output (length 0): prepend directive about empty response
  - Spinning (tool calls present, `wasNearIdentical`): prepend reassess directive
  - Otherwise: return `base`
  - Validation: unit test covering all branches
  - Done 2026-08-05.

- [x] 2.3 Wire `continuationPrompt` into `runIteration`
  - Pass previous result's signals; use returned string as the prompt text
  - Validation: `bun typecheck` passes
  - Done 2026-08-05: `Record_.lastOutcome` updated after every iteration;
    `matchesCompletion` receives the actual prompt text used (directive included)
    so echo detection stays correct.

- [x] 2.4 Add unit tests for `continuationPrompt`
  - Test: first iteration → base prompt unchanged
  - Test: stall outcome → directive prepended
  - Test: empty output → directive prepended
  - Test: spinning → reassess directive prepended
  - Test: normal progress → base prompt unchanged
  - Validation: `bun test test/loop/ --timeout 30000` — all pass
  - Done 2026-08-05: `test/loop/continuation.test.ts` (6 tests, includes
    substantive-no-tool-answer-is-not-a-stall).

## Phase 3: Pause Deferred (replace busy-poll)

- [x] 3.1 Add `pauseGate: Deferred.Deferred<void> | undefined` to `Record_`
  - Validation: `bun typecheck` passes
  - Done 2026-08-05.

- [x] 3.2 `pause()`: create a new `Deferred.make<void>()`, store in `record.pauseGate`, flip status to `"paused"`
  - Validation: `bun typecheck` passes
  - Done 2026-08-05.

- [x] 3.3 `resume()`: resolve the stored `pauseGate` Deferred, clear it, flip status to `"running"`
  - Validation: `bun typecheck` passes
  - Done 2026-08-05. Additionally: `cancel()` of a paused loop also resolves the
    gate — otherwise the run fiber stays parked on it forever (fiber leak).

- [x] 3.4 `run` fiber: replace `Effect.sleep("500 millis") + continue` with `Deferred.await(record.pauseGate)`
  - The fiber blocks at zero cost until `resume()` resolves the Deferred
  - Validation: `bun typecheck` passes; pause/resume test still passes in loop.test.ts
  - Done 2026-08-05 (sleep kept only as a defensive fallback for a gateless pause,
    which `pause()` cannot produce).

## Reversed 2026-08-06 — child sessions made the work invisible

Phase 1 gave every iteration a fresh child session for a clean context window.
That is real, but it moved the work out of the session the user is looking at, so
`/loop` and `/auto` appeared to do nothing at all — the first thing said on trying
`/auto` was "there is absolutely no output". Supervisability beats context hygiene:
iterations now run in the loop's own session, where they show up as ordinary turns
and any subagents appear as ordinary subagent parts. Compaction is what handles
context growth.

Kept from Phase 1: `iterationSessionID` (now the loop session, still what cancel
targets) and the foreign-turn guard, which matters MORE now that the session is
shared across iterations. Phases 2 and 3 (adaptive continuation prompt, pause
Deferred) are unaffected.

Re-attempted the same day as one session per CHANGE (rather than per iteration)
and reversed again for the same reason: a child session is still a keypress away,
so the main window still sits empty. If you try this a third time, know what the
child session was carrying: the authority ceiling. A child got its deny profile
at creation; a shared session has to be granted it for the duration of the run
and handed back afterwards, which is what `create` now does with `ensuring`.
That ruleset is not just about denying push — it is also what marks the session
unattended, so dropping it silently turns /auto back into something that stops
to ask.

## Phase 4: Tests & verification

- [x] 4.1 Update existing loop tests to account for child sessions (assertion on `info.iterationSessionID`)
  - Validation: `bun test test/loop/loop.test.ts --timeout 30000` — all pass
  - Done 2026-08-05: caller-session test now asserts the iteration ran in a child of
    the caller's session and `iterationSessionID` tracks it. 27/27 loop tests green.

- [x] 4.2 Add test: stall → adaptive prompt fires (mock LLM returns empty output twice, verify third iteration uses directive prompt)
  - Validation: new test passes
  - Done 2026-08-05: "a stalled iteration gets a directive continuation prompt in a
    fresh child session" — also asserts every iteration used a distinct child session
    and the user's base prompt survives in directive iterations.

- [x] 4.3 Run full typecheck
  - Validation: `bun typecheck` in packages/opencode — zero errors
  - Verified 2026-08-05 (workspace-wide).

- [x] 4.4 Rebuild binary
  - `bun run /path/to/packages/opencode/script/build.ts --single`
  - Validation: smoke test passes (`dist/.../opencode --version`)
  - Verified 2026-08-05: `dist/opencode-darwin-arm64/bin/opencode` built and
    smoke-passed (0.0.0-dev-...); per-iteration child sessions confirmed in a
    LIVE run — three iterations of one loop each reported a distinct
    `sessionID` (ses_030b06eb8f / ses_030b06b22f / ses_030b06797f).
