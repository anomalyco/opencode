---
phase: 01-configuration-foundation
plan: 02
subsystem: auth
tags: [zod, config, error-handling, pam]

# Dependency graph
requires:
  - phase: 01-01
    provides: AuthConfig schema and Duration utility
provides:
  - Config.Info extended with auth field
  - PamServiceNotFoundError error type
  - Auth-specific error formatting with actionable instructions
affects: [02-pam-authentication, 03-session-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - NamedError pattern for domain-specific errors
    - Schema composition (AuthConfig into Config.Info)

key-files:
  created: []
  modified:
    - packages/opencode/src/config/config.ts
    - packages/opencode/src/cli/error.ts

key-decisions:
  - "PamServiceNotFoundError placed in Config namespace (not AuthConfig) for consistency with other config errors"

patterns-established:
  - "Error types define data shape; FormatError handles user-facing messages"

# Metrics
duration: 3min
completed: 2026-01-20
---

# Phase 01 Plan 02: Auth Schema Integration Summary

**Config.Info extended with optional auth field; PamServiceNotFoundError with actionable setup instructions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-20T00:00:00Z
- **Completed:** 2026-01-20T00:03:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Auth configuration now available in opencode.json via Config.Info.auth field
- PamServiceNotFoundError defined for PAM service file validation errors
- Error formatting includes step-by-step PAM service creation instructions
- Invalid auth config uses existing Config.InvalidError formatting (shows field paths)

## Task Commits

Each task was committed atomically:

1. **Task 1: Integrate auth schema into Config.Info** - `a049dc62e` (feat)
2. **Task 2: Add auth error formatting** - `cffb0077a` (feat)

## Files Created/Modified

- `packages/opencode/src/config/config.ts` - Added AuthConfig import, auth field to Config.Info, PamServiceNotFoundError type
- `packages/opencode/src/cli/error.ts` - Added PamServiceNotFoundError handler with setup instructions

## Decisions Made

- **PamServiceNotFoundError in Config namespace:** Placed error in Config namespace (not separate AuthConfig) to follow existing pattern where config errors live in Config namespace and are handled by FormatError.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Auth configuration can now be added to opencode.json
- PamServiceNotFoundError ready for use in PAM authentication phase
- Error formatting ready to display helpful messages to users

---
*Phase: 01-configuration-foundation*
*Completed: 2026-01-20*
