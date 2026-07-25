# Tasks: fix-loop-reliability

## Phase 1: Per-iteration child sessions

- [ ] 1.1 Change `runIteration` to create a child session for each iteration
  - `loop.ts`: call `session.create({ parentID: loopSessionID, title: \`loop iter ${n}: ${promptHead}\` })` instead of reusing `record.info.sessionID`
  - Pass the child `sessionID` to `promptSvc.prompt()`
  - Add `iterationSessionID?: SessionID` to `Info` schema (optional, set after each iteration)
  - Validation: `bun typecheck` in packages/opencode — no errors

- [ ] 1.2 Update `patch` call after `runIteration` to store `iterationSessionID`
  - Validation: `bun typecheck` passes; running a loop creates child sessions visible in TUI session list

- [ ] 1.3 Add `iterationSessionID` to `Info` schema and `CreateInput` (optional read-only)
  - `loop.ts`: extend `Info` struct; keep backward-compatible (optional field)
  - Validation: `bun typecheck` passes; SDK types reflect the new field

- [ ] 1.4 Confirm `session.create({ parentID })` correctly limits inner step count
  - Child sessions have `parentID` set → `defaultSteps = DefaultSubAgentSteps = 50` applies
  - Validation: check `prompt.ts` logic — `session.parentID ? DefaultSubAgentSteps : Infinity`

## Phase 2: Adaptive continuation prompt

- [ ] 2.1 Add `PreviousOutcome` type to `loop.ts` capturing the signals needed for prompt selection
  - Fields: `toolCalls: number`, `outputLength: number`, `wasNearIdentical: boolean`

- [ ] 2.2 Implement `continuationPrompt(base: string, prev: PreviousOutcome | undefined): string`
  - First iteration (`prev === undefined`): return `base`
  - Stall (zero tool calls, short output ≤ 50 chars): prepend directive about executing the plan
  - Empty output (length 0): prepend directive about empty response
  - Spinning (tool calls present, `wasNearIdentical`): prepend reassess directive
  - Otherwise: return `base`
  - Validation: unit test covering all branches

- [ ] 2.3 Wire `continuationPrompt` into `runIteration`
  - Pass previous result's signals; use returned string as the prompt text
  - Validation: `bun typecheck` passes

- [ ] 2.4 Add unit tests for `continuationPrompt`
  - Test: first iteration → base prompt unchanged
  - Test: stall outcome → directive prepended
  - Test: empty output → directive prepended
  - Test: spinning → reassess directive prepended
  - Test: normal progress → base prompt unchanged
  - Validation: `bun test test/loop/ --timeout 30000` — all pass

## Phase 3: Pause Deferred (replace busy-poll)

- [ ] 3.1 Add `pauseGate: Deferred.Deferred<void> | undefined` to `Record_`
  - Validation: `bun typecheck` passes

- [ ] 3.2 `pause()`: create a new `Deferred.make<void>()`, store in `record.pauseGate`, flip status to `"paused"`
  - Validation: `bun typecheck` passes

- [ ] 3.3 `resume()`: resolve the stored `pauseGate` Deferred, clear it, flip status to `"running"`
  - Validation: `bun typecheck` passes

- [ ] 3.4 `run` fiber: replace `Effect.sleep("500 millis") + continue` with `Deferred.await(record.pauseGate)`
  - The fiber blocks at zero cost until `resume()` resolves the Deferred
  - Validation: `bun typecheck` passes; pause/resume test still passes in loop.test.ts

## Phase 4: Tests & verification

- [ ] 4.1 Update existing loop tests to account for child sessions (assertion on `info.iterationSessionID`)
  - Validation: `bun test test/loop/loop.test.ts --timeout 30000` — all 5 pass

- [ ] 4.2 Add test: stall → adaptive prompt fires (mock LLM returns empty output twice, verify third iteration uses directive prompt)
  - Validation: new test passes

- [ ] 4.3 Run full typecheck
  - Validation: `bun typecheck` in packages/opencode — zero errors

- [ ] 4.4 Rebuild binary
  - `bun run /path/to/packages/opencode/script/build.ts --single`
  - Validation: smoke test passes (`dist/.../opencode --version`)
