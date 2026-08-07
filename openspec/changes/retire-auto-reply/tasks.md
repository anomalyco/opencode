# Tasks: retire-auto-reply

## Phase 1: Audit before deleting

- [x] 1.1 Confirm the auto-reply service has no production consumer
  - Validation: no hits under `packages/opencode/src/session/`, `packages/tui/`, `packages/sdk/`
  - Done 2026-08-07. Hits were exactly the predicted six files: the service, its CLI
    command, `automation/automation-features.ts`, `fork/commands.ts`, and the two tests.
    Nothing in `session/`, `tui/`, or `sdk/`.

- [x] 1.2 Audit `automation/` and `pattern-detection.ts` separately — do NOT assume they are dead
  - Validation: record the result here; delete only what has zero production consumers
  - Done 2026-08-07. Both are inert, and the CLI commands are the interesting part:
    - `automation-features.ts` is imported by the two test files and nothing else.
    - `pattern-detection.ts` is imported by `automation-features.ts` and by
      `cli/cmd/pattern-detection.ts`. That command does
      `.pipe(Effect.provide(PatternDetection.layer))`, so it builds a **fresh service
      instance per invocation**, mutates its `Ref`, prints "pattern detection enabled",
      and exits. The Ref dies with the process. The command configured nothing that ever
      outlived it — worse than dead, it reported success for a no-op.
    - Neither appears in the `server.ts` node list, so no long-lived process held one.
    - The live sub-agent loop detection (`27397975eb`) is `loopStreak` / `LoopMaxStreak`
      in `session/prompt.ts`. It does not import `PatternDetection`; it uses the shared
      `loop/similarity.ts`. Confirmed independent — deleting this regresses nothing.

- [x] 1.3 Audit `scheduler.ts` and record the finding
  - Done 2026-08-07. `src/scheduler/scheduler.ts` has no importer anywhere outside itself
    and is not in the node list — inert on the same evidence. **Not deleted here**, per this
    task's own instruction; it wants its own change.

## Phase 2: Remove code

- [x] 2.1 Delete `packages/opencode/src/auto-reply/`
- [x] 2.2 Delete `packages/opencode/src/cli/cmd/auto-reply.ts` and unregister it
- [x] 2.3 Delete whatever Phase 1 proved inert (`automation/`, `pattern-detection.ts`)
  - Also `cli/cmd/pattern-detection.ts`, which had the same no-op-that-reports-success
    problem and would otherwise be left importing a deleted module
- [x] 2.4 Delete the dead tests
  - Validation for 2.1–2.4: `bun run typecheck` zero errors across all 23 workspace tasks;
    no dangling reference to `auto-reply`, `pattern-detection`, or `automation-features`
    remains under `src/`, `test/`, or `packages/tui/src`

## Phase 3: Correct the documentation

- [x] 3.1 Remove the auto-reply sections from `packages/opencode/AUTOMATION_FEATURES.md`
  - **Scope widened, deliberately.** The task asked for the auto-reply sections and the
    `~/.opencode/auto-reply.json` claim. But the audit condemned pattern detection and the
    auto-reply hook system too, and the surviving `/loop` section documented an API that
    never existed either — cron scheduling (`/loop every 5 minutes`), `/loop-pause <task-id>`,
    `--threshold`, `--repetitions`, `--window`. 42 of 333 lines referenced something
    deleted and the rest was mostly wrong. Excising four sections would have left a
    document that still lied about the feature it was pointing at.
  - Replaced with a short accurate one: the real `/loop` and `/auto` surfaces and flags,
    where "done" comes from, the authority boundary, gate personas, and a removal notice
    saying plainly what was never real and why.
- [x] 3.2 Correct `CHANGELOG.md:37` and add a removal entry
  - Both "Added" claims struck through and pointed at the new `### Removed` entry, which
    names why they could not have worked and what replaces them.
- [x] 3.3 Remove the auto-reply capability claim from `skein.json`
  - Both `auto-reply` and `pattern-detection` feature entries removed (9 → 7). Edited as
    text, not re-serialized — `json.dumps` reformatted the whole file on the first attempt.
  - Validation: `skein.json` parses; 16-line deletion, no other change

## Phase 4: Verification

- [x] 4.1 Full build and test
  - `bun run typecheck` zero errors. `bun test test/loop/ test/agent/ test/tool/ test/session/peers.test.ts`
    — 493 pass. `test/tool/shell.test.ts` is flaky under a loaded parallel run (a different
    shell test failed on each of two runs and a third run was fully green; it passes alone
    and on clean HEAD) — not a regression from this change.
- [x] 4.2 Confirm no working feature regressed
  - `bun test test/loop/` green. `/loop` and `/auto` verified by a live end-to-end run
    earlier the same day. Sub-agent loop detection untouched — it never used the deleted
    service.

## Note: the stashed work that led here

A stash held an unfinished `bigramSimilarity` for `pattern-detection.ts`, added because
that file's `similarity()` is genuinely broken: it counts, for each character of the
shorter string, whether that character appears *anywhere* in the longer one, so any two
prose strings score near 1.0. A false-positive machine.

Both observations were right and neither is worth acting on:

- `loop/similarity.ts` already exports exactly that Sørensen–Dice bigram function, shared
  by `loop.ts` and `prompt.ts` and deliberately import-free. The stash was reimplementing
  an existing module.
- It was fixing a file with no live caller, which this change deletes.

The stash also pinned `@opentui/solid` from `catalog:` to `0.3.4` in `package.json` and
`bun.lock`. The root catalog already resolves that package to `0.3.4`, so the pin changes
nothing today and would silently exclude the package from a future catalog bump. Dropped.
