# Eval harness

A thin, model-agnostic evaluation suite for the OpenCode agent harness. It measures
**verified task success**, not only whether the agent produced a plausible answer.
Every run uses a disposable workspace with an independent verifier, so a change to the
harness can be compared against a pinned baseline.

## What it measures

- **Verified success rate** — the primary metric. A run counts only when the agent
  exits cleanly, produces a completion, and the independent verifier passes.
- **Valid completion rate** — the agent exited cleanly and produced a completion,
  even if the verifier failed.
- **Cost per verified success** — total model cost divided by verified runs.
- **Cost, tokens, steps, tool calls, tool errors, duration** — per task and aggregate.
- **Median and p90 duration** — wall-clock time of the agent process.

The report intentionally separates valid completion from verified success: an answer
that looks finished is not a success unless the verifier agrees.

## Quick start

```sh
bun run eval -- --list
bun run eval -- --dry-run
bun run eval -- --audit
bun run eval -- --model <provider/model>
```

A real run requires a configured provider/model. Audit mode needs no model.

```sh
# Run every default task three times and fail if any run is unverified.
bun run eval -- --model <provider/model> --repeat 3 --fail-on-unverified

# Run selected tasks and keep disposable workspaces for inspection.
bun run eval -- --model <provider/model> --tasks range-inclusive,cache-dedupe --keep
```

## Audit mode

```sh
bun run eval -- --audit
```

Audit is the verifier's own test. For every selected task it:

1. builds the seeded workspace and requires the verifier to **fail** (except tasks
   marked `seeded: false`, which must pass);
2. applies the task's reference solution and requires the verifier to **pass**.

A task whose verifier cannot tell the seeded and solved states apart is not a valid
task. Audit needs no model and is safe to run in CI.

## Task format

Tasks are TypeScript objects under `eval/tasks/`. Each task has:

| Field | Meaning |
| --- | --- |
| `id` | Stable task identifier. |
| `category` | Reporting bucket (`bug-fix`, `feature`, `refactor`, ...). |
| `prompt` | Exact prompt sent to `opencode run`. |
| `files` | Fixture files written into the disposable workspace. |
| `verify.files` | Hidden verifier files written to `workspace/eval-verify/` after the agent finishes. |
| `verify.command` | Optional verifier command. Defaults to `bun test --timeout 30000`. |
| `solution` | Reference files used by audit. |
| `solutionFinal` | Reference final answer for audit on read-only tasks. |
| `seeded` | Defaults to `true`; the seeded state must fail verification. |
| `default` | Defaults to `true`; `false` excludes the task unless `--tasks all` is used. |
| `timeoutMs` | Optional per-task agent timeout override. |

Verifier files are written to `eval-verify/` **after** the agent exits. This keeps
hidden checks out of the agent's initial context and out of the baseline commit. The
directory is not dot-prefixed because Bun's test discovery skips dot directories.

## Reproducibility

Each report records:

- the repository commit at the start of the run and whether the tree was dirty;
- Bun version and platform;
- model, agent, repeat count, timeout, and task list;
- per-run stdout/stderr/diff/verification artifacts.

The runner creates its own git repository inside the disposable workspace and commits
the fixture as a baseline before the agent starts. The diff is captured after the agent
exits, so every run has a reviewable patch.

## Artifacts

By default results go to `eval/.runs/<timestamp>/` (ignored by git):

```
report.json          full structured report
summary.md           human-readable summary
<task>/run-N/
  stdout.jsonl       raw JSONL from opencode run
  stderr.log         agent stderr
  diff.patch         baseline-to-result patch
  verification.log   verifier stdout and stderr
```

Disposable workspaces are created under `/tmp/opencode/eval/<timestamp>-<pid>/` so the
repository's root `bunfig.toml` test guard cannot apply. They are deleted after each
run unless `--keep` is passed.

## Adding a task

1. Add `eval/tasks/<id>.ts` exporting a `Task`.
2. Register it in `eval/tasks/index.ts`.
3. Provide a seeded state that fails verification and a reference solution that passes.
4. Run `bun run eval -- --tasks <id> --audit`.
5. Run `bun check --no-script -p eval` and `./node_modules/.bin/oxlint eval`.

Prefer verifiers that assert behavior through the public API. Avoid reading the agent's
final prose when a code-level check can decide the outcome. The navigation task is the
exception: its contract is a correct answer with an unchanged workspace.

## Limitations

- The suite is synthetic and small. It is a smoke suite for harness changes, not a
  leaderboard, and one run per task cannot establish a stable difference between models.
- The default tasks cover TypeScript/Bun only. Add tasks for other languages before
  drawing broad conclusions.
- The verifier is only as good as the task author. Audit mode catches obvious
  over- and under-fitting, not every weak assertion.
- Real runs need provider credentials and can cost money. Start with a single task and
  `--repeat 1`.
