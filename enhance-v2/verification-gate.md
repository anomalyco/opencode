# Verification Gate (experimental)

## Goal

After the agent finishes a turn that changed files, run the project's verification command
once, feed the real output back on failure, and allow one repair step. Measure verified
success and cost per verified success against the same eval tasks without the gate.

## Scope

- New experimental config: `experimental.verification` (`true` for auto-detect, or
  `{ command, timeout, max_attempts }`).
- New `SessionVerification` service that runs the configured command through the existing
  `Shell.Service` and returns pass/fail/skip.
- Wire it into `SessionRunnerLLM` only when:
  - the session is not a subagent,
  - the current turn changed files,
  - no background shell/subagent work is outstanding,
  - the attempt budget is not exhausted.
- On failure, admit one synthetic steer with the command and truncated output.
- On pass or skip, finish normally.
- Eval flag `--gate` to enable the feature for a run.

## Non-goals

- No prompt-only reminder.
- No change to tool permissions or shell safety.
- No automatic commit, formatter, or linter beyond the configured command.
- No model-specific behavior.

## Implementation

### Change detection

`SessionStep.Outcome.Completed` now carries `changed: boolean`. It is computed from the
step's start and end snapshots:

```ts
changed = startSnapshot !== undefined && snapshot !== undefined && startSnapshot !== snapshot
```

`SessionRunnerLLM` accumulates `changed` across the turn's steps and only runs verification
when the final step completes and the turn changed anything. This avoids importing
`SessionDiff` and `LocationServiceMap` into the runner, which caused a TypeScript 7.1
circular-inference cascade across unrelated files.

### Command resolution

`SessionVerification` reads the latest `experimental.verification` setting.

- `true`: read `package.json` in the session location and choose the first defined script
  from `test`, `check`, `typecheck`, `lint`. Detect the package manager from the lockfile,
  defaulting to `bun`.
- Object: use its `command`, `timeout`, and `max_attempts` directly.

The check runs through `Shell.Service`, so it receives the normal timeout and capture
behavior. Output is truncated to the last 8,000 characters before it is sent back.

### Admission and retry

On failure the runner admits a durable synthetic inbox item with `delivery: "steer"` and
the command, exit code, output, and repair instruction. The normal inbox promotion path
delivers it at the next step boundary. `max_attempts` bounds how many failures may produce
a follow-up; the default is one. Subagents, closed locations, and turns with outstanding
background work skip verification.

### Config normalization

`ConfigNormalize` only copies known `experimental` keys, so `experimental.verification`
was added to that whitelist. Without it the config decoded but was silently dropped before
reaching the runner. A focused normalization test now covers `true`, `false`, the object
form, duration encoding, and invalid values.

## Tasks

1. Add `experimental.verification` to the config schema.
2. Add `packages/core/src/session/verification.ts` with command resolution and `check`.
3. Add `changed` to `SessionStep.Outcome.Completed`.
4. Wire the gate into `packages/core/src/session/runner/llm.ts` and its node deps.
5. Preserve the setting in `packages/core/src/config/normalize.ts`.
6. Add `--gate` to `eval/run.ts` and pass `OPENCODE_CONFIG_CONTENT`.
7. Add tests for command resolution, config normalization, and step change detection.
8. Run the full core test suite, root typecheck, and lint.

## Verification

```sh
cd packages/core && bun run test test/session-verification.test.ts test/session-step.test.ts
cd packages/core && bun run test test/config/normalization.test.ts
cd packages/core && bun run typecheck:tsc --force
cd packages/core && bun run test
bun run check
./node_modules/.bin/oxlint packages/core/src/session/verification.ts \
  packages/core/src/session/runner/llm.ts \
  packages/core/src/session/runner/step.ts \
  packages/core/src/config/normalize.ts \
  packages/core/test/session-verification.test.ts \
  packages/core/test/config/normalization.test.ts \
  packages/schema/src/config/experimental.ts eval/run.ts
bun run eval -- --audit --tasks all
```

## Success criteria

- Gate disabled: behavior and eval results unchanged.
- Gate enabled with a passing command: no extra model step, same verified result.
- Gate enabled with a failing command: exactly one synthetic follow-up, then the normal
  completion path.
- Typecheck, lint, and the full core test suite are clean.

## Current limitation

The gate's repair loop is implemented and typechecked, but the model-facing A/B measurement
is still blocked by provider access. The deterministic parts (command resolution, config
normalization, and snapshot change detection) are covered by tests; the remaining
end-to-end evidence requires a working panel provider or a local OpenAI-compatible server.
