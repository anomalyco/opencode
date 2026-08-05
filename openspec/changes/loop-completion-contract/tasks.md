# Tasks: loop-completion-contract

## Phase 1: Configurable token

- [x] 1.1 Add `completionToken` to the loop schemas
  - `loop.ts`: add `completionToken: Schema.optional(Schema.String)` to `Info` and `CreateInput`
  - `create` defaults it to the existing `COMPLETE_SIGNAL` constant when absent
  - Validation: `bun typecheck` in packages/opencode — zero errors
  - Verified 2026-08-05: `Info.completionToken` (required in Info, optional in CreateInput),
    `create` defaults via `input.completionToken?.trim() || DEFAULT_COMPLETION_TOKEN`.

- [x] 1.2 Mirror the field in the SDK arg defaults
  - `packages/sdk/js/src/v2/loop-args.ts`: add `completionToken` to `LoopArgDefaults`
  - Validation: `bun typecheck` passes; generated SDK types include the field
  - Verified 2026-08-05: `LoopArgDefaults.completionToken` present; generated v2 SDK
    carries the field (`types.gen.ts`, `sdk.gen.ts` body key `completionToken`).
    Also: `parseLoopArgs` now accepts `--completion-token <word>` so the TUI `/loop`
    path can set it, and `opencode loop` gained the `--completion-token` flag (the
    old "SDK not regenerated yet" blocker no longer holds).

## Phase 2: Disclose the contract to the model

- [x] 2.1 Implement `contractPart(token: string, iteration: number, max: number): string`
  - Returns the `<loop-contract>` block naming the token and the emit condition
  - Pure function, no imports from `prompt.ts` (preserve the cycle break from `e156296ad5`)
  - Validation: unit test asserts the token literal appears in the output
  - Verified 2026-08-05: `src/loop/completion.ts` (import-free); covered by
    `test/loop/completion.test.ts` ("names the exact token…").

- [x] 2.2 Append the contract as a second text part in `runIteration`
  - `loop.ts`: parts become `[{type:"text",text:record.info.prompt}, {type:"text",text:contractPart(...)}]`
  - User prompt stays first and unmodified
  - Validation: `bun typecheck` passes
  - Verified 2026-08-05.

- [x] 2.3 Assert non-loop sessions are unaffected
  - Validation: `bun test test/session/ --timeout 30000` — no contract text in ordinary turns
  - Verified 2026-08-05: contract injection lives only in `loop.ts` `runIteration`;
    prompt suite green except 5 failures unrelated to the contract (task metadata
    timing, cancel propagation, shell queue — tracked under
    session-cancellation-integrity). No ordinary-turn test observes contract text.

## Phase 3: Harden detection

- [x] 3.1 Implement `matchesCompletion(output: string, token: string, promptText: string): boolean`
  - Case-insensitive; collapse whitespace inside the tag; tolerate a surrounding code fence
  - Only consider the trailing 200 characters of `output`
  - Return false if the same occurrence appears verbatim in `promptText`
  - Validation: unit tests for each of the four rules
  - Verified 2026-08-05: all four rules covered in `test/loop/completion.test.ts`.

- [x] 3.2 Replace `output.includes(COMPLETE_SIGNAL)` with `matchesCompletion(...)`
  - Validation: `bun typecheck` passes
  - Verified 2026-08-05: `runIteration` computes `complete: matchesCompletion(output, token, prompt)`.

- [x] 3.3 Add matcher edge-case tests
  - Test: trailing token on its own line → completes
  - Test: token inside ` ``` ` fence at end → completes
  - Test: token mentioned early followed by 500 chars → does not complete
  - Test: token present in the user prompt and echoed → does not complete
  - Test: `<promise>complete</promise>` lowercase → completes
  - Validation: `bun test test/loop/ --timeout 30000` — all pass
  - Verified 2026-08-05: 15 completion tests + 5 loop-service tests, 20/20 green.

## Phase 4: Surface it in help

- [x] 4.1 State the stop word in `opencode loop --help`
  - `cli/cmd/loop.ts`: extend the command description with the default token
  - Also correct the inaccurate "omit for back-to-back ralph style" text — `DefaultIntervalSeconds = 2` is applied at wait time regardless
  - Validation: `opencode loop --help` shows the token and an accurate interval description
  - Done 2026-08-05: describe names the token and that it is disclosed per iteration;
    interval text already stated the real default. `--completion-token` flag added.

- [x] 4.2 Show the stop word in the TUI `/loop` hint
  - `packages/tui/src/component/prompt/index.tsx` (~:1138-1172 intercept path)
  - Validation: manual — `/loop` hint names the token
  - Done 2026-08-05: loop-started toast reports the active stop word; the `/loops`
    dialog empty state names the default token.

## Phase 5: Verification

- [x] 5.1 Full loop test suite green
  - Validation: `bun test test/loop/loop.test.ts --timeout 30000` — all pass including the two pre-existing COMPLETE_SIGNAL tests
  - Verified 2026-08-05: 20/20. NOTE: the suite was red before this pass — not from
    contract code, but because `LocalProviderSync` (in `Provider.defaultLayer`) LAN-scanned
    from inside tests and could route test prompts to real fleet providers. Fixed by
    `OPENCODE_DISABLE_LOCAL_SYNC=1` in `test/preload.ts` + a gate in `src/local/sync.ts`.
    Tests also gained the missing `AutoMode.defaultLayer` (prompt.test.ts, loop.test.ts).

- [x] 5.2 End-to-end: a real loop reaches `completed`
  - Run `opencode loop "<prompt>" --max 3` against a local provider
  - Validation: loop ends with status `completed`, not `max_reached`
  - Verified 2026-08-05 against z4/qwen3.6-35b-a3b-q8-0 via a server on :2601:
    `loop_fcf519f41001X0ZZxzJPZJ0rvw` reached **completed** (token emitted on
    iteration 3). Two findings from the live run, both fixed/confirmed:
    (a) `opencode loop "<prompt>"` and `opencode loop list` were BROKEN at HEAD —
    all five `loop *` commands registered as separate top-level yargs commands,
    which collide on the first token so the last-registered (`loop resume <id>`)
    always won. Fixed by nesting list/cancel/pause/resume under the parent's
    builder (`cli/cmd/loop.ts`, `fork/commands.ts`).
    (b) A weak default model ignores the contract and the loop correctly ends
    `stalled`; `promptDisablesCompletion` also correctly refused a token that
    appeared in the prompt (ended `max_reached` with the warning logged).

- [x] 5.3 Full typecheck
  - Validation: `bun typecheck` in packages/opencode — zero errors
  - Verified 2026-08-05 (workspace-wide `bun run typecheck`).
