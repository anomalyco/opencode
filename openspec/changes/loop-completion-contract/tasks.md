# Tasks: loop-completion-contract

## Phase 1: Configurable token

- [ ] 1.1 Add `completionToken` to the loop schemas
  - `loop.ts`: add `completionToken: Schema.optional(Schema.String)` to `Info` and `CreateInput`
  - `create` defaults it to the existing `COMPLETE_SIGNAL` constant when absent
  - Validation: `bun typecheck` in packages/opencode — zero errors

- [ ] 1.2 Mirror the field in the SDK arg defaults
  - `packages/sdk/js/src/v2/loop-args.ts`: add `completionToken` to `LoopArgDefaults`
  - Validation: `bun typecheck` passes; generated SDK types include the field

## Phase 2: Disclose the contract to the model

- [ ] 2.1 Implement `contractPart(token: string, iteration: number, max: number): string`
  - Returns the `<loop-contract>` block naming the token and the emit condition
  - Pure function, no imports from `prompt.ts` (preserve the cycle break from `e156296ad5`)
  - Validation: unit test asserts the token literal appears in the output

- [ ] 2.2 Append the contract as a second text part in `runIteration`
  - `loop.ts:161-166`: parts become `[{type:"text",text:record.info.prompt}, {type:"text",text:contractPart(...)}]`
  - User prompt stays first and unmodified
  - Validation: `bun typecheck` passes

- [ ] 2.3 Assert non-loop sessions are unaffected
  - Validation: `bun test test/session/ --timeout 30000` — no contract text in ordinary turns

## Phase 3: Harden detection

- [ ] 3.1 Implement `matchesCompletion(output: string, token: string, promptText: string): boolean`
  - Case-insensitive; collapse whitespace inside the tag; tolerate a surrounding code fence
  - Only consider the trailing 200 characters of `output`
  - Return false if the same occurrence appears verbatim in `promptText`
  - Validation: unit tests for each of the four rules

- [ ] 3.2 Replace `output.includes(COMPLETE_SIGNAL)` at `loop.ts:207` with `matchesCompletion(...)`
  - Validation: `bun typecheck` passes

- [ ] 3.3 Add matcher edge-case tests
  - Test: trailing token on its own line → completes
  - Test: token inside ```` ``` ```` fence at end → completes
  - Test: token mentioned early followed by 500 chars → does not complete
  - Test: token present in the user prompt and echoed → does not complete
  - Test: `<promise>complete</promise>` lowercase → completes
  - Validation: `bun test test/loop/ --timeout 30000` — all pass

## Phase 4: Surface it in help

- [ ] 4.1 State the stop word in `opencode loop --help`
  - `cli/cmd/loop.ts`: extend the command description with the default token
  - Also correct the inaccurate "omit for back-to-back ralph style" text — `DefaultIntervalSeconds = 2` is applied at wait time regardless
  - Validation: `opencode loop --help` shows the token and an accurate interval description

- [ ] 4.2 Show the stop word in the TUI `/loop` hint
  - `packages/tui/src/component/prompt/index.tsx` (~:1138-1172 intercept path)
  - Validation: manual — `/loop` hint names the token

## Phase 5: Verification

- [ ] 5.1 Full loop test suite green
  - Validation: `bun test test/loop/loop.test.ts --timeout 30000` — all pass including the two pre-existing COMPLETE_SIGNAL tests

- [ ] 5.2 End-to-end: a real loop reaches `completed`
  - Run `opencode loop "echo hello then stop" --max 5` against a local provider
  - Validation: loop ends with status `completed`, not `max_reached`

- [ ] 5.3 Full typecheck
  - Validation: `bun typecheck` in packages/opencode — zero errors
