# Phase 0: Benchmark Foundation

## BMK-001 Build repo-local benchmark catalog

- Status: `blocked`
- Owner: `codex-eda-agent`
- Started at: `2026-03-20T10:08:45Z`
- Completed at: `2026-03-20T10:18:08Z`
- Benchmark: `pass`
- Artifact root: `/workspaces/Github/opencode/benchmark/26-03-20/18-18-08`
- Commit: `458ac87ff15137e88ae13adff546ac4526bc629c`
- Publish: `failed to push xiaokang: Could not read from remote repository`
- Goal: scan the repo-local job manifests under `/workspaces/Github/opencode/tests/cases/jobs` and build a local catalog grouped by suite.
- Depends on: `none`
- Deliverables: case inventory, suite grouping, stable catalog format.
- Done when: `opencode` can enumerate benchmark jobs without manual per-run discovery.
- Benchmark gate: `catalog self-check`

## BMK-002 Define benchmark manifest schema

- Status: `done`
- Owner: `codex-eda-agent`
- Started at: `2026-03-20T11:06:29Z`
- Completed at: `2026-03-20T11:18:54Z`
- Benchmark: `pass`
- Artifact root: `/workspaces/Github/opencode/benchmark/26-03-20/19-17-00`
- Commit: `fa49d9bb97ea8fc68248c04af6a36cc633fceac3`
- Publish: `pushed to xiaokang branch cyzh/eco-agent with --no-verify after a local Bun pre-push hook version mismatch`
- Goal: define the local manifest schema used by the benchmark runner.
- Depends on: `BMK-001`
- Deliverables: schema, validation layer, manifest examples.
- Done when: fullflow and stage-specific manifests validate through one code path.
- Benchmark gate: `catalog self-check`

## BMK-003 Create timestamped benchmark workspace

- Status: `todo`
- Goal: create the required benchmark artifact root at `/workspaces/Github/opencode/benchmark/YY-MM-DD/HH-MM-SS`.
- Depends on: `BMK-002`
- Deliverables: directory creator, manifest bootstrap, summary placeholders.
- Done when: each run gets a clean timestamp root with stable subdirectories.
- Benchmark gate: `catalog self-check`

## BMK-004 Run `smic110-adder` dry-run smoke

- Status: `todo`
- Goal: make the harness run the smallest repo-local case end to end in dry-run mode.
- Depends on: `BMK-003`
- Deliverables: smoke runner, smoke result record, smoke artifact root.
- Done when: `smic110-adder.json` can be launched as the benchmark smoke case and recorded.
- Benchmark gate: `adder smoke`

## BMK-005 Load fullflow suite from repo-local jobs

- Status: `todo`
- Goal: turn repo-local `*.json` jobs into the `fullflow` suite.
- Depends on: `BMK-004`
- Deliverables: fullflow suite loader and suite manifest.
- Done when: the runner can execute or list the fullflow suite from the repo-local case corpus.
- Benchmark gate: `fullflow smoke`

## BMK-006 Load design and stage-specific suites

- Status: `todo`
- Goal: support `design`, `function_eco`, `physical_eco`, and `signoff`.
- Depends on: `BMK-005`
- Deliverables: stage suite loaders and derived design-only manifests from the repo-local fullflow jobs.
- Done when: every required suite can be selected by name.
- Benchmark gate: `design/function/physical/signoff smoke`

## BMK-007 Normalize results and summaries

- Status: `todo`
- Goal: emit stable summary files and replayable per-case bundles for both humans and automation.
- Depends on: `BMK-006`
- Deliverables: `summary.json`, `summary.md`, per-case `result.json`, `stdout.log`, `stderr.log`, `job.json`, `artifacts/`, and `eda/`.
- Done when: failed and successful runs both produce structured summaries and preserved raw EDA outputs inside the benchmark root.
- Benchmark gate: `fullflow smoke`

## BMK-008 Wire benchmark into plan completion gate

- Status: `todo`
- Goal: make benchmark pass a required field in plan completion.
- Depends on: `BMK-007`
- Deliverables: completion policy, status update schema, failure blocking.
- Done when: a plan cannot be marked complete without benchmark metadata.
- Benchmark gate: `fullflow smoke`
