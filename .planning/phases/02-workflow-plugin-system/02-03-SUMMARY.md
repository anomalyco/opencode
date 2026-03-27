---
phase: 02-workflow-plugin-system
plan: 03
subsystem: cli
tags: [cli, workflow, yargs, subcommands]
dependency_graph:
  requires: [02-01]
  provides: [WorkflowCommand yargs module, cobuilder workflow CLI entry point]
  affects: [src/index.ts top-level CLI]
tech_stack:
  added: []
  patterns: [yargs CommandModule, @clack/prompts spinner/log, cmd() wrapper]
key_files:
  created:
    - packages/opencode/src/cli/cmd/workflow.ts
  modified:
    - packages/opencode/src/index.ts
decisions:
  - Used cmd() wrapper consistent with all other CLI commands (mcp, onboard, run, etc.)
  - Parent command uses `workflow <action>` positional + demandCommand to enforce subcommand
  - spinner() wraps install/remove for progress; log.info() used for list output
metrics:
  duration: ~5 minutes
  completed: 2026-03-26
  tasks_completed: 2
  files_modified: 2
---

# Phase 02 Plan 03: `cobuilder workflow` CLI Subcommand Summary

**One-liner:** `cobuilder workflow add/list/remove` yargs subcommands wired to Workflow.install/list/remove via @clack/prompts spinner feedback.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create workflow.ts with add/list/remove | ad97d79 | packages/opencode/src/cli/cmd/workflow.ts |
| 2 | Register WorkflowCommand in index.ts | ad97d79 | packages/opencode/src/index.ts |

## What Was Built

- `packages/opencode/src/cli/cmd/workflow.ts` — exports `WorkflowCommand` (parent) plus three internal subcommands:
  - `workflowAddCmd` (`add <source>`): resolves alias/URL, spins while cloning, prints restart notice on success
  - `workflowListCmd` (`list`): prints name@version — description + path for each installed workflow, or "No workflows installed" when empty
  - `workflowRemoveCmd` (`remove <name>`): spins while removing, exits 1 on error
- `packages/opencode/src/index.ts` — added import + `.command(WorkflowCommand)` after `OnboardCommand`

## Verification

- `bun run typecheck` — 13/13 tasks successful, 0 errors
- WorkflowCommand appears in `cobuilder --help` output (registered in yargs chain)
- `cobuilder workflow --help` shows add/list/remove subcommands

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all subcommands are fully wired to `Workflow.install`, `Workflow.list`, and `Workflow.remove`.

## Self-Check: PASSED

- packages/opencode/src/cli/cmd/workflow.ts — FOUND
- packages/opencode/src/index.ts (WorkflowCommand import + .command) — FOUND
- commit ad97d79 — FOUND
