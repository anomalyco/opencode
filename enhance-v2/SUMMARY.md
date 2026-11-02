# Enhance v2 — Evaluation Harness Slice

## Objective

Improve the OpenCode harness in a model-agnostic way. The first slice is a thin,
reproducible evaluation harness that measures **verified task success**, cost, tokens, and
latency instead of relying on prompt prose or one model's output.

## What was built

A root-level `eval/` suite with:

- **10 default synthetic TypeScript/Bun tasks + 1 control task** covering bug fixes,
  concurrency, features, refactors, test repair, import/build repair, navigation, CLI,
  multi-file work, and regression.
- **Hidden verifiers** written to `workspace/eval-verify/` only after the agent exits.
- **Disposable workspaces** with a fresh git baseline commit per run.
- **Headless execution** through `opencode run --format json --auto --standalone`.
- **JSONL parsing** for steps, tool calls, tool errors, final text, tokens, cache tokens,
  and cost.
- **Independent verification** with `bun test` (or a task-specific command).
- **Audit mode** that requires seeded tasks to fail and reference solutions to pass.
- **JSON/Markdown reports** with verified success rate, valid completion rate, cost per
  verified success, median/p90 duration, tokens, tool errors, and per-category totals.
- **Reproducibility metadata** for the baseline commit, dirty state, Bun version, platform,
  model, agent, timeout, and task list.

## Files

| Path | Purpose |
| --- | --- |
| `eval/types.ts` | Task, usage, process, and run result types. |
| `eval/parse.ts` | Parses `opencode run --format json` JSONL. |
| `eval/run.ts` | Runner, audit mode, reporting, CLI flags, workspace lifecycle. |
| `eval/tasks/shared.ts` | Shared fixture package metadata. |
| `eval/tasks/index.ts` | Task registry. |
| `eval/tasks/*.ts` | 10 default tasks plus the control task. |
| `eval/README.md` | Task format, usage, artifacts, and limitations. |
| `eval/tsconfig.json` | Typecheck project for the suite. |
| `eval/.gitignore` | Ignores `eval/.runs/`. |
| `enhance-v2/verification-gate.md` | Verification-gate design, implementation, and verification. |
| `packages/core/src/session/verification.ts` | Command resolution and one-shot verification through `Shell.Service`. |
| `packages/core/src/session/runner/step.ts` | Reports whether a completed step changed files. |
| `packages/core/src/session/runner/llm.ts` | Runs the gate after terminal completion and admits a bounded repair steer. |
| `packages/schema/src/config/experimental.ts` | Adds `experimental.verification`. |
| `packages/core/src/config/normalize.ts` | Preserves `experimental.verification` through normalization. |
| `package.json` | Adds the root `eval` script. |

## Key design decisions

- **Verified success is the primary metric.** A run is successful only when the agent
  exits cleanly, produces a completion, and the verifier passes.
- **Audit is the verifier's test.** Every seeded task must fail verification; every
  reference solution must pass. This catches verifiers that cannot distinguish the two
  states.
- **The verifier is independent of the agent.** Hidden files are written after the agent
  exits, so they are not in the prompt or baseline commit.
- **Workspaces live outside the repository.** They are created under
  `/tmp/opencode/eval/<timestamp>-<pid>/` so the repository's `bunfig.toml` test guard
  cannot affect verifier runs.
- **The CLI source runs from `packages/cli`.** That directory's `bunfig.toml` loads the
  `@opentui/solid/preload` needed for the TUI's Solid JSX. `PWD` is set to the disposable
  workspace so `opencode run` uses it as the session root.
- **The first harness change is the experimental verification gate.** The measurement
  infrastructure was built first so later harness changes can be compared against a clean
  baseline. See `enhance-v2/verification-gate.md`.

## Usage

```sh
bun run eval -- --list
bun run eval -- --dry-run
bun run eval -- --audit --tasks all
bun run eval -- --model <provider/model> --gate
bun run eval -- --model <provider/model> --repeat 3 --fail-on-unverified
```

Useful flags: `--tasks`, `--repeat`, `--timeout`, `--out`, `--keep`, `--bin`, `--agent`,
`--gate`, `--fail-on-unverified`.

## Verification evidence

### Typecheck

```text
$ bun check --no-script -p eval
✓ No type errors in 16 files [41.00ms]
```

`bun check -p eval` initially resolved to the repository's `check` script; `--no-script`
runs Bun's built-in checker against `eval/tsconfig.json`.

### Lint

```text
$ ./node_modules/.bin/oxlint eval
Found 0 warnings and 0 errors.
Finished in 174ms on 16 files with 1 rules using 16 threads.
```

### Task discovery

```text
$ bun run eval -- --list
range-inclusive      bug-fix          default
cache-dedupe         bug-fix          default
slugify              feature          default
rename-api           refactor         default
test-repair          test-repair      default
import-fix           build-failure    default
navigation           navigation       default
cli-json             cli              default
todo-store           feature          default
duration-parser      regression       default
```

`control` is registered but excluded from the default selection. Use `--tasks all` to
include it.

### Dry run

```text
$ bun run eval -- --dry-run
baseline 67139d6827af3a337c80472c33f9cb7c6c2ce500 (dirty)
bun 1.4.4 linux-x64
model (not set)
agent build
out /home/rtx/coreHx/opencode-lab/eval/.runs/2026-11-02T14-27-16-716Z
tasks 10: range-inclusive, cache-dedupe, slugify, rename-api, test-repair, import-fix, navigation, cli-json, todo-store, duration-parser
```

### Verifier audit — all tasks

```text
$ bun run eval -- --audit --tasks all
audit: expected seeded failure and solution pass
ok   range-inclusive seeded fail solution pass
ok   cache-dedupe seeded fail solution pass
ok   slugify seeded fail solution pass
ok   rename-api seeded fail solution pass
ok   test-repair seeded fail solution pass
ok   import-fix seeded fail solution pass
ok   navigation seeded fail solution pass
ok   cli-json seeded fail solution pass
ok   todo-store seeded fail solution pass
ok   duration-parser seeded fail solution pass
ok   control seeded pass solution pass
```

### Real headless smoke

```text
$ bun run eval -- --model 'cloudflare-workers-ai/@cf/openai/gpt-oss-120b' \
    --tasks control --repeat 1 --out /tmp/opencode/eval-smoke-9 --keep
eval 1/1 control run 1 verified 7.9s $0.0055
verified 1/1 (100.0%), cost $0.0055
report /tmp/opencode/eval-smoke-9/report.json
```

Report metrics:

```json
{
  "runs": 1,
  "verified": 1,
  "validCompletions": 1,
  "verifiedSuccessRate": 1,
  "totalCost": 0.00545075,
  "costPerVerifiedSuccess": 0.00545075,
  "totalTokens": 15489,
  "steps": 1,
  "toolCalls": 0,
  "durationMs": 7910,
  "errors": []
}
```

The real run also validated the parser against real JSONL. Earlier attempts recorded
`step_finish` events with tokens and cost, and one `tool_use` event with a completed shell
call. Those runs failed on provider limits or provider tool-message compatibility, not on
harness logic:

- `opencode/deepseek-v4.1-flash-free`: HTTP 429, free usage limit reached.
- `cloudflare-ai-gateway/google/gemini-2.5-flash-lite`: HTTP 402, insufficient gateway
  balance.
- `cloudflare-workers-ai/@cf/openai/gpt-oss-120b`: first step and tool call parsed; the
  next request was rejected by Workers AI with a 400 on tool-result message content.
- `cloudflare-workers-ai/@cf/qwen/qwen2.5-coder-32b-instruct`: invalid stream event.
- `cloudflare-workers-ai/@cf/moonshotai/kimi-k2.7-code`: not available on the Workers Free
  plan.

### Verification gate

The first harness change adds an experimental post-completion verification gate. The
implementation and its separate design notes are in `enhance-v2/verification-gate.md`.

Deterministic checks:

```text
$ cd packages/core && bun run test test/session-verification.test.ts test/session-step.test.ts
 8 pass
 0 fail
 50 expect() calls

$ cd packages/core && bun run test test/config/normalization.test.ts
 44 pass
 0 fail
 403 expect() calls

$ cd packages/core && bun run typecheck:tsc --force
exit 0, 0 errors

$ cd packages/core && bun run test
 7204 pass
 25 skip
 0 fail
 97137 expect() calls
 Ran 7229 tests across 312 files

$ bun run check
 Tasks: 35 successful, 35 total
 Time: 19.273s

$ ./node_modules/.bin/oxlint <changed files>
Found 0 warnings and 0 errors.
```

The gate is wired into the runner and config normalization, but the model-facing A/B
measurement is still blocked by provider access. The current evidence proves the
deterministic pieces; it does not yet prove a verified-success improvement.

### Wire-level note

The first wiring attempt imported `SessionDiff` and `LocationServiceMap` into the runner.
That triggered a TypeScript 7.1 circular-inference cascade: 81 errors across unrelated
files, while the HEAD baseline had zero. Change detection now uses the step snapshot
comparison already available in `SessionStep`, and the runner no longer imports those
modules. The forced `tsc` build is clean.

## Baseline and environment

- Repository: `/home/rtx/coreHx/opencode-lab`
- HEAD: `67139d6827af3a337c80472c33f9cb7c6c2ce500`
- Branch: `dev`
- Bun: `1.4.4`
- Platform: `linux-x64`
- Working tree at first report: dirty (the `eval/` suite and `package.json` script are new)
- Dependencies installed with `bun install --frozen-lockfile` (1798 packages; lockfile
  unchanged).

The harness records the commit and dirty state in every report, so baseline records remain
meaningful even before the suite is committed.

## Limitations and next steps

- The suite is synthetic and small. One run per task is a smoke signal, not a stable
  model comparison.
- The default tasks are TypeScript/Bun only. Add tasks for other languages before drawing
  broad conclusions.
- The control task is intentionally tool-free so a clean model completion can validate the
  end-to-end path across providers. Tool-use behavior is covered by the other tasks.
- Next useful slices: run the suite across a model panel, record per-model verified
  success/cost, then add only the harness changes that improve the panel rather than the
  best model.
- The verification gate's repair loop is implemented but not yet measured against a model.
  Provider access is the blocker: Workers AI still rejects tool-result follow-ups with a
  400, and the other panel providers are unavailable on this account.
