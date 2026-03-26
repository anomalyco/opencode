---
phase: 02-workflow-plugin-system
plan: "01"
subsystem: workflow
tags: [workflow, registry, install, remove, zod]
dependency_graph:
  requires: []
  provides: [Workflow.Service, REGISTRY, resolveSource]
  affects: [future CLI commands, future workflow loader]
tech_stack:
  added: []
  patterns: [namespace-as-module, gray-matter frontmatter, Bun.spawnSync for git]
key_files:
  created:
    - packages/opencode/src/workflow/registry.ts
    - packages/opencode/src/workflow/registry.test.ts
    - packages/opencode/src/workflow/index.ts
    - packages/opencode/src/workflow/index.test.ts
  modified: []
decisions:
  - "Used md.data (gray-matter API) not md.frontmatter for ConfigMarkdown.parse() return value"
  - "workflowsDir() placed under Global.Path.config/workflows (XDG config, not data dir)"
  - "remove() matches by both directory basename and manifest name for flexibility"
metrics:
  duration: "~15 minutes"
  completed: "2026-03-26"
  tasks: 2
  files: 4
---

# Phase 02 Plan 01: Workflow.Service + Registry Summary

**One-liner:** Alias registry (gsd/ralph-loop/gstack → GitHub URLs) plus list/install/remove service backed by opencode.json workflow.paths.

## Tasks Completed

| # | Task | Commit |
|---|------|--------|
| T1 | registry.ts + registry.test.ts | aab7bc3 |
| T2 | index.ts (Workflow.Service) + index.test.ts | 965b868 |

## What Was Built

**registry.ts** — `REGISTRY` map (3 aliases) and `resolveSource()` that passes through full URLs and throws on unknown aliases.

**index.ts** — `Workflow` namespace exposing:
- `Info` — Zod schema validating WORKFLOW.md frontmatter (`name` required, `version`/`description`/`commands` optional)
- `list()` — reads `workflow.paths` from `opencode.json`, parses each WORKFLOW.md, returns typed array
- `install(source)` — resolves alias via `resolveSource()`, `git clone`s into `~/.config/opencode/workflows/<name>/`, validates manifest, deduplicates before writing config
- `remove(name)` — finds by dir name or manifest name, deletes dir, removes from config
- `parseManifest(dir)` — wraps `ConfigMarkdown.parse()` + `Info.parse(md.data)`, returns null on failure

**Tests:** 15 total (14 pass, 1 integration skip for git clone).

## Deviations from Plan

**1. [Rule 1 - Bug] Corrected ConfigMarkdown.parse() return field**
- **Found during:** T2 implementation
- **Issue:** Plan referenced `md.frontmatter` but gray-matter returns `.data`
- **Fix:** Used `md.data` in `parseManifest()`
- **Files modified:** packages/opencode/src/workflow/index.ts

None other — plan executed as written.

## Known Stubs

None. All operations are fully wired. Install/remove require a real filesystem; integration test for git clone is intentionally skipped with `test.skip`.

## Self-Check: PASSED

- packages/opencode/src/workflow/registry.ts — FOUND
- packages/opencode/src/workflow/index.ts — FOUND
- packages/opencode/src/workflow/registry.test.ts — FOUND
- packages/opencode/src/workflow/index.test.ts — FOUND
- Commit aab7bc3 — FOUND
- Commit 965b868 — FOUND
- bun test registry.test.ts — 6/6 pass
- bun test index.test.ts — 8 pass, 1 skip
- bun run typecheck — 0 workflow errors
