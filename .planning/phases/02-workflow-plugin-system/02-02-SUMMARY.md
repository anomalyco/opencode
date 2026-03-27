---
phase: 02-workflow-plugin-system
plan: "02"
subsystem: config
tags: [config, workflow, schema, zod]
dependency_graph:
  requires: [02-01]
  provides: [workflow.paths schema, workflow directory injection]
  affects: [Config.Info, Config.state, loadCommand scan]
tech_stack:
  added: []
  patterns: [zod schema extension, directory injection loop]
key_files:
  modified:
    - packages/opencode/src/config/config.ts
decisions:
  - Added workflow.paths inside Config.Info z.object (not .strict() — safe alongside skills)
  - Injected paths after result is fully merged but before unique(directories) loop so loadCommand scans them
  - Added workflow.paths merge to mergeConfigConcatArrays (array concat, not replace)
metrics:
  duration: ~4m
  completed: "2026-03-26"
  tasks: 1
  files: 1
---

# Phase 02 Plan 02: Config.Info Schema Extension + Directory Injection Summary

Config.Info Zod schema extended with optional workflow.paths field; workflow plugin directories auto-injected into Config.state directory scan before loadCommand() runs.

## What Was Done

- **Edit 1 — Schema field:** Added `workflow: z.object({ paths: z.array(z.string()).optional() }).optional()` to `Config.Info` after the `skills` field (line 1062).
- **Edit 2 — Directory injection:** Inserted a `for...of` loop over `result.workflow?.paths ?? []` immediately after `ConfigPaths.directories()` is called and before the `unique(directories)` scan loop, expanding `~/` prefixes via `os.homedir()`.
- **Edit 3 — Array merge:** Added `workflow.paths` handling to `mergeConfigConcatArrays` so multiple config sources concat (not replace) their path lists.

## Deviations from Plan

### Auto-added

**1. [Rule 2 - Missing functionality] Added workflow.paths to mergeConfigConcatArrays**
- **Found during:** T1 implementation review
- **Issue:** Plan mentioned this as a "do NOT modify unless needed" note but array merging is required for correctness — without it, a project config's workflow.paths would silently overwrite global config paths
- **Fix:** Added concat merge alongside existing plugin/instructions handling
- **Files modified:** packages/opencode/src/config/config.ts
- **Commit:** fd799bd

## Verification

- `grep "workflow: z.object" packages/opencode/src/config/config.ts` — found at line 1062
- `grep "cfg.workflow?.paths"` — found at line 143 (uses `result.workflow?.paths` — variable name at injection point)
- `grep "directories.push(expanded)"` — found at line 147
- `bun run typecheck` — 13/13 tasks successful, 0 errors

## Self-Check: PASSED

- File exists: packages/opencode/src/config/config.ts — FOUND
- Commit fd799bd — FOUND (feat/phase2-workflow-plugins branch)
