---
phase: 08-session-enhancements
plan: 01
subsystem: auth
tags: [session, cookies, authentication, remember-me, hono]

# Dependency graph
requires:
  - phase: 04-authentication-flow
    provides: UserSession creation and cookie management
  - phase: 06-login-ui
    provides: Login page HTML form
provides:
  - Remember me checkbox with persistent session cookies (30-day default)
  - Session timeout differentiation (regular vs remember-me)
  - Extended session duration for remember-me users
affects: [09-session-indicator, future-auth-enhancements]

# Tech tracking
tech-stack:
  added: []
  patterns: [Optional session persistence via rememberMe flag, Cookie maxAge calculation for persistent sessions]

key-files:
  created: []
  modified:
    [
      packages/opencode/src/session/user-session.ts,
      packages/opencode/src/server/middleware/auth.ts,
      packages/opencode/src/server/routes/auth.ts,
    ]

key-decisions:
  - "Remember me checkbox is checked by default for user convenience"
  - "Cookie maxAge must be in seconds (Hono requirement) not milliseconds"
  - "Session timeout uses rememberMeDuration for remember-me sessions, sessionTimeout for regular sessions"
  - "Form submission includes rememberMe value from checkbox state"

patterns-established:
  - "Optional parameters follow `maybeX` naming convention in UserSession.create"
  - "Cookie duration configuration via parseDuration helper converts strings like '90d' to milliseconds"
  - "Session schema extensibility via optional fields"

# Metrics
duration: 4min
completed: 2026-01-23
---

# Phase 8 Plan 1: Remember Me Backend Summary

**Persistent session cookies with 30-day remember-me duration, differentiated timeouts, and checked-by-default login checkbox**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-23T18:12:18Z
- **Completed:** 2026-01-23T18:16:10Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- UserSession schema extended with rememberMe field for session persistence tracking
- setSessionCookie sets persistent cookies (with maxAge) when rememberMe=true
- Login form checkbox checked by default, sends rememberMe value to server
- Server-side timeout respects rememberMe flag (90-day vs 7-day default)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add rememberMe to UserSession schema and creation** - `2751ea879` (feat)
2. **Task 2: Update setSessionCookie to support persistent cookies** - `e2865ab22` (feat)
3. **Task 3: Wire rememberMe through login flow** - `f0012b284` (feat)

## Files Created/Modified

- `packages/opencode/src/session/user-session.ts` - Added rememberMe field to Info schema and create() parameter
- `packages/opencode/src/server/middleware/auth.ts` - Updated setSessionCookie to accept rememberMe parameter and set maxAge; authMiddleware uses correct timeout based on session.rememberMe
- `packages/opencode/src/server/routes/auth.ts` - Login form checkbox checked by default, loginRequestSchema includes rememberMe, form submission sends rememberMe value, server passes it to session creation and cookie setting

## Decisions Made

**1. Remember me checkbox checked by default**

- Rationale: Per CONTEXT.md, user explicitly wants convenience of remember-me as default

**2. Cookie maxAge in seconds not milliseconds**

- Rationale: Hono's setCookie maxAge parameter expects seconds; must divide parseDuration result by 1000

**3. Session timeout differentiation**

- Rationale: Remember-me sessions use rememberMeDuration (90d default), regular sessions use sessionTimeout (7d default) to match cookie persistence

**4. rememberMe defaults to false when undefined**

- Rationale: Backward compatibility and explicit opt-in semantics

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Backend "remember me" functionality is complete. Ready for:

- Session indicator in UI (Phase 8 Plan 2)
- Activity-based session refresh
- Session expiration warnings

The session persistence infrastructure is now in place and working correctly.

---

_Phase: 08-session-enhancements_
_Completed: 2026-01-23_
