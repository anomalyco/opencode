---
phase: 04-authentication-flow
plan: 02
subsystem: auth
tags: [hono, login, csrf, session, pam, broker]

# Dependency graph
requires:
  - phase: 03
    provides: BrokerClient for PAM authentication
  - phase: 04-01
    provides: getUserInfo for UNIX user lookup, UserSession with UNIX fields
provides:
  - POST /auth/login endpoint for credential authentication
  - GET /auth/status endpoint for auth configuration
  - Full login flow: validate -> broker auth -> user info -> session create -> cookie set
affects: [04-03, frontend-login]

# Tech tracking
tech-stack:
  added: []
  patterns: [X-Requested-With CSRF protection, dual content-type support, returnUrl validation]

key-files:
  created: [packages/opencode/test/server/routes/auth.test.ts]
  modified: [packages/opencode/src/server/routes/auth.ts]

key-decisions:
  - "X-Requested-With header required for basic CSRF protection"
  - "Support both JSON and form-urlencoded POST bodies"
  - "Generic auth_failed error on all auth failures (no user enumeration)"
  - "returnUrl validation prevents open redirect attacks"

patterns-established:
  - "Login endpoints require X-Requested-With header"
  - "All auth failures return generic error message"
  - "returnUrl must start with / and not contain // or newlines"

# Metrics
duration: 4min
completed: 2026-01-20
---

# Phase 4 Plan 2: Login Endpoint Summary

**Login endpoint with broker authentication, UNIX identity lookup, and session creation with CSRF protection**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-20T22:15:47Z
- **Completed:** 2026-01-20T22:19:47Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- POST /auth/login endpoint accepting JSON and form POST bodies
- GET /auth/status endpoint returning auth enabled state and method
- Full authentication flow: CSRF check -> broker auth -> user info lookup -> session create -> cookie set
- 17 tests covering login endpoint behavior including edge cases

## Task Commits

Each task was committed atomically:

1. **Task 1-2: Add login and status endpoints** - `e84202dcc` (feat)
2. **Task 3: Add login endpoint tests** - `8a3358d04` (test)

## Files Created/Modified

- `packages/opencode/src/server/routes/auth.ts` - Added POST /login and GET /status endpoints
- `packages/opencode/test/server/routes/auth.test.ts` - 17 tests for login and status endpoints

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| X-Requested-With header required | Basic CSRF protection - browser won't add this header cross-origin |
| Support JSON and form POST | Flexibility for different client implementations |
| Generic auth_failed error | Security - prevents user enumeration attacks |
| returnUrl validation | Prevents open redirect vulnerabilities |

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Login endpoint complete, ready for frontend integration
- Status endpoint available for client to check auth state before showing login form
- No blockers for Phase 4 Plan 3

---
*Phase: 04-authentication-flow*
*Completed: 2026-01-20*
