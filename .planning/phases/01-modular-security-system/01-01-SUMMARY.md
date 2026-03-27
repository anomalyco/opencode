---
phase: 1
plan: 1
subsystem: security/config
tags: [security, config, zod, ssrf, headers]
dependency_graph:
  requires: []
  provides: [Config.Info.security schema, SSRF guard, headers guard]
  affects: [packages/opencode/src/config/config.ts, packages/opencode/src/cli/cmd/onboard.ts, packages/opencode/src/server/server.ts]
tech_stack:
  added: []
  patterns: [default-on via !== false, Zod .strict() optional sub-schema]
key_files:
  modified:
    - packages/opencode/src/config/config.ts
    - packages/opencode/src/cli/cmd/onboard.ts
    - packages/opencode/src/server/server.ts
decisions:
  - Used !== false (not === true) for all guards — absent key means module enabled
  - Inserted security schema before .strict() call to avoid TypeScript error
metrics:
  duration: ~5 minutes
  completed: 2026-03-26
  tasks_completed: 3
  files_modified: 3
---

# Phase 1 Plan 1: Security Config Schema + Confirmed Call Site Guards Summary

**One-liner:** Zod security sub-schema added to Config.Info with 6 configurable modules, SSRF and headers guards wired via default-on `!== false` pattern.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| T1 | Add `security` key to Config.Info Zod schema | f012e83 |
| T2 | Guard SSRF call site in onboard.ts (SEC-01) | f012e83 |
| T3 | Guard security headers call site in server.ts (SEC-06) | f012e83 |

## What Was Built

- **Config schema (config.ts):** `security` optional sub-object with sub-schemas for `ssrf`, `promptInjection`, `pathTraversal`, `auditLog`, `rateLimiting` (with token-bucket fields), and `headers`. Inserted before `.strict()` call — existing configs without a `security` key parse without error.

- **SSRF guard (onboard.ts):** `Config.get()` fetched before the `validateProviderURL` call; check runs only when `cfg.security?.ssrf?.enabled !== false`. Config import added.

- **Headers guard (server.ts):** Hono middleware now checks `cfg.security?.headers?.enabled !== false` before calling `getSecurityHeaders()`. Config import added.

## Decisions Made

- `!== false` pattern used throughout — absent key means enabled (SEC-07 default-on guarantee).
- All three changes in one commit since they form an atomic foundational unit (schema must exist for guards to typecheck).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `packages/opencode/src/config/config.ts` — modified, security schema present
- `packages/opencode/src/cli/cmd/onboard.ts` — modified, SSRF guard present
- `packages/opencode/src/server/server.ts` — modified, headers guard present
- Commit f012e83 — verified via git log
- `bun run typecheck` — passed (zero errors)
