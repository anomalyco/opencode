# Tasks: Make `/loop` relentless by default

## Slice 1: Post-completion continuation

- [x] 1.1 On plain-mode completion, run the disk-derived eligible-change resolver
      (`resolveQueue`) against `openspec/changes/` before finalizing as `completed`.
  - File: `packages/opencode/src/loop/loop.ts` (`runPromptThenMaybeQueue`)
  - Validation: `bun test test/loop/queue-mode.test.ts`
- [x] 1.2 If an eligible change is found, transition the loop record into queue-style
      continuation (`mode: "queue"`, seeded `QueueState`, then hand off to `runQueue`) instead of
      finalizing; log the transition and the next change. Also: apply the SAME `QueueDenyRules`
      authority ceiling a loop created directly in queue mode gets, restored on exit — an eternal
      plain loop must never end up with more authority than a queue loop has today. Also guards
      against transitioning into a directory that already has an active queue loop (the same
      conflict `QueueActiveError` prevents at creation time).
  - File: `packages/opencode/src/loop/loop.ts`
  - Validation: `bun test test/loop/queue-mode.test.ts` — "a completed prompt-mode loop continues
    into backlog work instead of stopping"
- [x] 1.3 If no eligible change is found, finalize as `completed` exactly as today.
  - File: `packages/opencode/src/loop/loop.ts`
  - Validation: covered by existing `loop.test.ts` completion tests (no fixture backlog present)

## Slice 2: Bounded stall reprieve

- [x] 2.1 On hitting `noProgressLimit`, send one harder-line directive iteration before
      finalizing as `stalled`, reusing `runIteration`'s `override` parameter rather than a new
      prompt-selection path.
  - File: `packages/opencode/src/loop/loop.ts`
  - Validation: `bun test test/loop/loop.test.ts` — "grants one bounded reprieve before stalling
    when eternal (default)"
- [x] 2.2 Track that the reprieve has been used (`Record_.stallReprieve: "pending" | "used"`) so a
      second stall after the reprieve halts immediately — never more than one reprieve per loop
      lifetime.
  - File: `packages/opencode/src/loop/loop.ts`
  - Validation: same test — asserts exactly 2x `noProgressLimit` iterations, not unbounded

## Slice 3: `--eternal` opt-out

- [x] 3.1 Add `eternal?: boolean` to `CreateInput` (optional, default resolved to `true` in
      prompt mode) and `eternal: boolean` to `Info` (always resolved, `false` in queue mode since
      queue mode is already relentless by construction); CLI flag `--eternal`/`--no-eternal` and
      TUI `--no-eternal`.
  - File: `packages/opencode/src/loop/loop.ts`, `packages/opencode/src/cli/cmd/loop.ts`,
    `packages/tui/src/component/prompt/index.tsx`
  - Validation: `bun run typecheck` (opencode, tui, sdk all clean)
- [x] 3.2 Thread `eternal: false` through to skip both Slice 1 and Slice 2 behavior, restoring
      prior stop-on-completion/stop-on-stall behavior exactly.
  - File: `packages/opencode/src/loop/loop.ts`
  - Validation: `bun test test/loop/loop.test.ts` ("stalls after..." now pins `eternal: false`),
    `test/loop/queue-mode.test.ts` — "eternal: false stops a completed prompt-mode loop even with
    backlog work pending"
- [x] 3.3 SDK: `packages/sdk/js/src/v2/loop-args.ts` gains `eternal` (`--no-eternal` flag,
      defaults `true`); regenerated `packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts` via
      `bun packages/sdk/js/script/build.ts` (scoped regen — avoids `script/generate.ts`'s
      whole-repo reformat side effect noted in prior session notes).
  - File: `packages/sdk/js/src/v2/loop-args.ts`, `packages/sdk/js/src/v2/gen/*.gen.ts`
  - Validation: `bun run typecheck` (sdk)

## Slice 4: Priority-aware queue ordering

- [x] 4.1 Already implemented — `resolveQueue`/`compareOrder` in
      `packages/opencode/src/loop/spec-queue/queue.ts` already sort eligible changes by an
      explicit `priority` key read from each change's `.openspec.yaml` (default 100), then
      `created` date, then slug. No code change needed; the "known follow-up" this slice was
      tracking predates the current tree.
  - Evidence: `packages/opencode/src/loop/spec-queue/queue.ts:36-96` (`ChangeOrder`,
    `readOrder`, `compareOrder`)

## Slice 5: Whole-turn tool-call counting

- [x] 5.1 Already implemented — `runIteration` in `packages/opencode/src/loop/loop.ts` (not
      `continuation.ts`, correcting this task's original file reference) sums tool-call parts
      across every assistant message created since the iteration started
      (`turnMessages`/`countedTools`), not just the message `promptSvc.prompt` returns, with a
      documented incident ("observed on a real run that had just deleted four files") explaining
      why. No code change needed; the "known follow-up" this slice was tracking predates the
      current tree.
  - Evidence: `packages/opencode/src/loop/loop.ts:422-442`

## Slice 6: Verification

- [x] 6.1 `bun run typecheck` (opencode, sdk, tui) and full `bun test test/loop/` green — 153
      pass, 0 fail.
- [ ] 6.2 Live check: run plain `/loop` on a prompt that completes quickly while
      `openspec/changes/` has other eligible work; confirm it transitions to queue mode and keeps
      going, and that `--eternal=false` stops it at completion as before. Covered by an
      integration test (`queue-mode.test.ts`) but not yet observed on a real fleet run.
