---
phase: 21-ssh-key-management
plan: 01
subsystem: api
tags: [ssh, ssh-keys, storage, hono, zod]

# Dependency graph
requires:
  - phase: 04-authentication-flow
    provides: Authenticated sessions with user identity
provides:
  - SSH key storage and install helpers with managed config updates
  - Authenticated SSH key CRUD API routes
affects: [21-ssh-key-management-02, sdk, app-settings]

# Tech tracking
tech-stack:
  added: []
  patterns: [Managed SSH config block, Per-user Storage namespace]

key-files:
  created:
    - packages/opencode/src/ssh/keys.ts
    - packages/opencode/src/server/routes/ssh-keys.ts
  modified:
    - packages/opencode/src/server/server.ts

key-decisions:
  - "Use a managed ~/.ssh/config block to keep OpenCode entries isolated."
  - "Install keys under ~/.ssh/opencode with strict permissions."

patterns-established:
  - "SshKey namespace encapsulates storage, install, and config updates."
  - "SSH key routes return consistent error objects with message/help_steps."

# Metrics
duration: 5 min
completed: 2026-02-01
---

# Phase 21: SSH Key Management Summary

**SSH key storage, install helpers, and authenticated CRUD routes with managed ~/.ssh/config entries.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-01T01:02:32Z
- **Completed:** 2026-02-01T01:07:10Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added SshKey storage module with install/uninstall flows and fingerprinting
- Added authenticated SSH key CRUD routes with Zod validation
- Registered SSH key routes in the server router

## Task Commits

Each task was committed atomically:

1. **Task 1: Create SSH key storage + install helpers** - `09f91745f` (feat)
2. **Task 2: Add SSH key CRUD routes and server registration** - `3e3bcd7af` (feat)

**Plan metadata:** (docs commit follows after summary + STATE updates)

## Files Created/Modified
- `packages/opencode/src/ssh/keys.ts` - Storage + install helpers and managed config updates
- `packages/opencode/src/server/routes/ssh-keys.ts` - Authenticated SSH key CRUD routes
- `packages/opencode/src/server/server.ts` - SSH key route registration

## Decisions Made
- Use a managed SSH config block to keep key entries scoped to OpenCode.
- Store SSH keys under a dedicated `~/.ssh/opencode` directory with strict permissions.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SSH key APIs and storage are ready for SDK regeneration and UI integration.
- No blockers identified.

---
*Phase: 21-ssh-key-management*
*Completed: 2026-02-01*
