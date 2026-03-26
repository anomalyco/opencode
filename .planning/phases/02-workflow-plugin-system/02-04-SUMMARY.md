---
phase: 02-workflow-plugin-system
plan: "04"
subsystem: workflow
tags: [security, sandboxing, reference-plugin, docs]
dependency_graph:
  requires: [02-01, 02-02, 02-03]
  provides: [path-traversal-prevention, gsd-reference-scaffold, workflow-plugin-docs]
  affects: [Workflow.install]
tech_stack:
  added: []
  patterns: [path-sandboxing, plugin-manifest-scaffold]
key_files:
  created:
    - packages/opencode/src/workflow/sandbox.ts
    - packages/opencode/src/workflow/gsd-reference/WORKFLOW.md
    - packages/opencode/src/workflow/gsd-reference/commands/plan-phase.md
    - packages/opencode/src/workflow/gsd-reference/commands/execute-phase.md
    - packages/opencode/src/workflow/gsd-reference/commands/discuss-phase.md
    - packages/opencode/src/workflow/gsd-reference/hooks/.gitkeep
    - docs/workflow-plugins.md
  modified:
    - packages/opencode/src/workflow/index.ts
decisions:
  - sandbox check uses path.resolve + startsWith(base + sep) to prevent both traversal and exact-base installs being misclassified
  - hooks/ scaffolded as empty directory (WF-09 scope boundary — no execution wired)
metrics:
  duration: ~5 minutes
  completed: 2026-03-26
  tasks_completed: 2
  files_created: 7
  files_modified: 1
---

# Phase 02 Plan 04: Sandboxing + GSD Reference Plugin + Docs Summary

Path traversal prevention via `validateWorkflowPath()` wired into `Workflow.install()`, plus a canonical GSD reference plugin scaffold and user-facing plugin authoring docs.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| T1 | Create sandbox.ts + wire into install() | 2e09c3a |
| T2 | GSD reference plugin scaffold + docs | 26b5867 |

## What Was Built

**T1 — sandbox.ts**
- `validateWorkflowPath(destDir)` resolves both `base` and `destDir` via `path.resolve()`, then checks `resolved.startsWith(base + path.sep)` to block any path that escapes `~/.config/opencode/workflows/`
- Called synchronously in `Workflow.install()` immediately after `destDir` is derived, before any `fs.mkdir` or `git clone`
- Throws a clear security error message including both the offending path and the expected sandbox root

**T2 — GSD reference plugin**
- `gsd-reference/WORKFLOW.md` — canonical manifest with `name: gsd`, `version: 1.0.0`, `commands: [plan-phase, execute-phase, discuss-phase]`
- `commands/plan-phase.md`, `commands/execute-phase.md`, `commands/discuss-phase.md` — stub slash command definitions with YAML frontmatter
- `hooks/.gitkeep` — scaffolds `hooks/` directory; WF-09 scopes hook execution to a future phase
- `docs/workflow-plugins.md` — user-facing authoring guide: directory layout, WORKFLOW.md format, CLI commands, built-in aliases, hooks future note

## Verification

- `bun run typecheck`: 13/13 tasks successful, 0 errors
- `bun test src/workflow` (from packages/opencode): 14 pass, 0 fail

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None that block the plan's goal. The GSD reference plugin command stubs are intentionally minimal — they are documentation-only scaffolds demonstrating the plugin format. Actual GSD command logic lives in the external `gsd-workflow` repository (installed via `cobuilder workflow add gsd`).

## Self-Check: PASSED

- packages/opencode/src/workflow/sandbox.ts — FOUND
- packages/opencode/src/workflow/index.ts (validateWorkflowPath import + call) — FOUND
- packages/opencode/src/workflow/gsd-reference/WORKFLOW.md — FOUND
- packages/opencode/src/workflow/gsd-reference/commands/plan-phase.md — FOUND
- packages/opencode/src/workflow/gsd-reference/hooks/.gitkeep — FOUND
- docs/workflow-plugins.md — FOUND
- Commits 2e09c3a, 26b5867 — FOUND
