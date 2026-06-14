# @opencode-ai/evolve

Trace-reflective **self-evolution** for daemoncode skills — a native-TypeScript port
of the GEPA (Genetic-Pareto Prompt Evolution) idea used by
[hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution).

It reads *why* an agent's skill fell short (from execution traces), proposes targeted
rewrites, evaluates them against a dataset, keeps the **Pareto frontier** across competing
objectives, and enforces hard **constraint gates** — never auto-deploying beyond writing the
artifact, so promotion goes through the normal PR + test gate.

## Loop

```
baseline ─▶ reflect on failing traces ─▶ mutate (LLM) ─▶ gate (size/name/headings)
   ▲                                                          │
   └──────────── Pareto select ◀── evaluate (scorer) ◀────────┘   × N generations
```

- **Reflection** (`mutate.ts`) — builds a prompt from the *failure reasons* in traces, not
  just pass/fail, then parses the rewritten skill body.
- **Evaluation** (`evaluate.ts`) — `keywordScorer` (deterministic, offline) or
  `llmJudgeScorer` (when credentials exist). Aggregates to objectives `{ score, passRate, sizeBytes }`.
- **Selection** (`pareto.ts`) — maximize score & pass rate, minimize size; non-dominated set.
- **Gates** (`constraints.ts`) — non-empty, ≤15KB, frontmatter `name` preserved, required
  headings retained.
- **Report / deploy** (`report.ts`, `deploy.ts`) — markdown report + line diff; writes the
  winner only when it improves the baseline.

## Objectives mapping to daemoncode

| GEPA mutates | daemoncode artifact |
| --- | --- |
| `SKILL.md` (Phase 1, implemented) | `packages/*/skill` skills |
| execution traces (reflection input) | `packages/opencode/src/ace/{trace,replay}.ts`, session events |
| deploy gate | the repo's PR + `bun test` flow |

## Usage

```bash
# Offline / no credentials (deterministic mock model):
bun run packages/evolve/src/cli.ts run \
  --skill packages/evolve/examples/skills/git-commit/SKILL.md \
  --dataset packages/evolve/examples/datasets/git-commit.json \
  --mock --generations 4 --population 2

# Real model (set ANTHROPIC_API_KEY, optionally ANTHROPIC_BASE_URL / EVOLVE_MODEL):
bun run packages/evolve/src/cli.ts run --skill <SKILL.md> --dataset <dataset.json> \
  --judge --out report.md --write
```

Flags: `--generations`, `--population`, `--judge` (LLM scorer), `--mock` (offline model),
`--out <file>`, `--write` (materialize the winning skill), `--model <id>`.

## Status

Phase 1 (skill optimization) is implemented end-to-end with a deterministic offline path so
the loop is fully testable without model access. Tool-description, system-prompt, and
tool-code phases reuse the same gate/Pareto/report core and are future work.

```bash
bun test packages/evolve
```
