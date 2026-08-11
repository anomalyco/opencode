# Tasks: sub-agent loop detection

## Phase 1: PatternDetection tool-usage support

- [x] 1. Add bigram similarity helper to PatternDetection for tool usage comparison
  - Files: packages/opencode/src/pattern-detection/pattern-detection.ts
  - Validation: `cd packages/opencode && npm run build` — compiles without error; verify `bigramSimilarity` or equivalent function exists in the file

- [x] 2. Update PatternDetection.detectPattern() to compare toolUsage strings when both entries have toolUsage
  - Files: packages/opencode/src/pattern-detection/pattern-detection.ts
  - Validation: `cd packages/opencode && npm run build` — compiles without error; verify toolUsage comparison logic is present in `detectPattern`

- [x] 3. Add unit test for PatternDetection with tool usage — verify loop is detected when same tool sequence repeats ≥ maxRepetitions times
  - Files: packages/opencode/test/pattern-detection/pattern-detection.test.ts (or existing test file)
  - Validation: `cd packages/opencode && npx vitest run --testNamePattern "tool usage"` — new test passes

- [x] 4. Add unit test for PatternDetection — verify no false positive when tool sequences vary between turns
  - Files: packages/opencode/test/pattern-detection/pattern-detection.test.ts (or existing test file)
  - Validation: `cd packages/opencode && npx vitest run --testNamePattern "tool usage"` — new test passes

## Phase 2: Wire into prompt loop

- [x] 5. Import PatternDetection service into prompt.ts and extract tool usage string from message parts
  - Files: packages/opencode/src/session/prompt.ts
  - Validation: `cd packages/opencode && npm run build` — compiles without error; `grep -n "PatternDetection\|toolUsage" packages/opencode/src/session/prompt.ts` shows import and usage

- [x] 6. Add PatternDetection.detectPattern() call after the existing bigram check in the prompt loop (lines 1415-1455), passing text and tool usage string
  - Files: packages/opencode/src/session/prompt.ts
  - Validation: `cd packages/opencode && npm run build` — compiles without error; verify detectPattern call exists near line 1455

- [x] 7. Implement loop abort on PatternDetection hit: set handle.message.error, update message, publish error event, break loop
  - Files: packages/opencode/src/session/prompt.ts
  - Validation: `cd packages/opencode && npm run build` — compiles without error; verify error handling path mirrors existing bigram abort logic (lines 1434-1446)

## Phase 3: Configuration

- [x] 8. Enable patternDetection by default in AutomationFeatures config (set enabled: true)
  - Files: packages/opencode/src/automation/automation-features.ts
  - Validation: `grep "patternDetection" packages/opencode/src/automation/automation-features.ts` shows `enabled: true`

## Phase 4: Integration tests
- [x] 9. Add integration test: sub-agent with 5 consecutive turns using same tool sequence is detected and aborted
  - Files: packages/opencode/test/session/prompt.test.ts
  - Validation: `cd packages/opencode && npx vitest run --testNamePattern "tool.*loop"` — test passes

- [x] 10. Add regression test: existing text-only bigram loop detection still works unchanged (no tool calls, repeated text)
  - Files: packages/opencode/test/session/prompt.test.ts
  - Validation: `cd packages/opencode && npx vitest run --testNamePattern "bigram.*loop"` — test passes

- [x] 11. Add regression test: loop detection does NOT trigger on legitimate varying tool usage
  - Files: packages/opencode/test/session/prompt.test.ts
  - Validation: `cd packages/opencode && npx vitest run --testNamePattern "no.*loop"` — test passes

## Phase 5: Verification

- [x] 12. Run full test suite — ensure no regressions in prompt loop, loop engine, or pattern detection
  - Files: all
  - Validation: `cd packages/opencode && npx vitest run` — all tests pass
