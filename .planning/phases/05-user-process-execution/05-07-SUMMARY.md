---
phase: 05-user-process-execution
plan: 07
subsystem: auth
tags: [broker, pty, session, integration]

# Dependency graph
requires:
  - phase: 05-06
    provides: BrokerClient with registerSession, unregisterSession, spawnPty
provides:
  - Web server integration with broker for session lifecycle
  - PTY creation routing based on auth configuration
affects: [05-08-pty-lifecycle-events, 05-09-client-pty-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Fire-and-forget broker calls on auth events
    - Auth-aware PTY routing (broker vs local)

key-files:
  modified:
    - packages/opencode/src/server/routes/auth.ts
    - packages/opencode/src/pty/index.ts
    - packages/opencode/src/session/user-session.ts

key-decisions:
  - "Fire-and-forget registration: broker calls don't block login/logout flow"
  - "Graceful degradation: web access works even if broker unavailable"
  - "PTY broker path throws 'not yet implemented' for I/O - Plan 05-08 will complete"

patterns-established:
  - "Auth event hooks: register on login, unregister on logout"
  - "Auth-conditional routing: check ServerAuth.get().enabled for branching"

# Metrics
duration: 2min
completed: 2026-01-22
---

# Phase 5 Plan 7: Web Server Integration Summary

**Integrated broker session registration into auth flow and added auth-aware PTY creation routing**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-22T11:31:14Z
- **Completed:** 2026-01-22T11:33:46Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Session registration with broker after successful login
- Session unregistration from broker on logout (single and logout-all)
- PTY creation routing through broker when auth enabled
- Fire-and-forget pattern for broker calls to avoid blocking auth flow

## Task Commits

Each task was committed atomically:

1. **Task 1: Register session with broker on login** - `ec939e739` (feat)
2. **Task 2: Unregister session with broker on logout** - `30f7abe32` (feat)
3. **Task 3: Route PTY creation through broker when auth enabled** - `4ac32cd44` (feat)

## Files Created/Modified
- `packages/opencode/src/server/routes/auth.ts` - Added broker session registration/unregistration
- `packages/opencode/src/pty/index.ts` - Added auth-aware PTY creation routing
- `packages/opencode/src/session/user-session.ts` - Added getSessionIdsForUser helper

## Decisions Made

1. **Fire-and-forget broker calls** - Registration/unregistration don't block the main auth flow. If broker is down, user can still use web interface, just not spawn PTYs as their user.

2. **getSessionIdsForUser helper** - Added to UserSession namespace to support logout-all with broker unregistration.

3. **Broker PTY path throws** - The createViaBroker function throws "not yet implemented" because PTY I/O streaming requires additional work in Plan 05-08.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness
- Session lifecycle integrated with broker
- PTY routing in place, ready for I/O streaming (Plan 05-08)
- Existing non-auth PTY behavior preserved

---
*Phase: 05-user-process-execution*
*Completed: 2026-01-22*
