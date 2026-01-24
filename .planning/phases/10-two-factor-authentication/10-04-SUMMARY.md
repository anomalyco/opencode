---
phase: 10-two-factor-authentication
plan: 04
subsystem: auth
tags: [2fa, totp, broker-client, ipc]

# Dependency graph
requires:
  - phase: 10-02
    provides: Broker protocol extension for check2fa and authenticateotp methods
provides:
  - check2fa() method on BrokerClient
  - authenticateOtp() method on BrokerClient
  - TypeScript IPC interface for 2FA operations
affects: [10-05, 10-06, login-ui-2fa]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - BrokerClient method pattern for 2FA (matches existing authenticate/ping style)

key-files:
  created: []
  modified:
    - packages/opencode/src/auth/broker-client.ts

key-decisions:
  - "check2fa fails open (returns false on error) for detection-only use case"
  - "authenticateOtp follows authenticate() pattern exactly for consistency"

patterns-established:
  - "2FA methods use same request/response pattern as password auth"

# Metrics
duration: 2min
completed: 2026-01-24
---

# Phase 10 Plan 04: BrokerClient 2FA Methods Summary

**TypeScript client methods for 2FA operations via IPC protocol - check2fa() for detection and authenticateOtp() for validation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-24T22:44:26Z
- **Completed:** 2026-01-24T22:46:12Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments
- Extended BrokerRequest interface with check2fa and authenticateotp methods
- Implemented check2fa() to detect if user has 2FA configured
- Implemented authenticateOtp() to validate OTP codes via broker

## Task Commits

Each task was committed atomically:

1. **Task 1: Add check2fa and authenticateOtp to BrokerRequest interface** - `41866cdde` (feat)
2. **Task 2: Implement check2fa method** - `f6fa7d9ce` (feat)
3. **Task 3: Implement authenticateOtp method** - `314ba01c0` (feat)

## Files Created/Modified
- `packages/opencode/src/auth/broker-client.ts` - Added 2FA methods (check2fa, authenticateOtp) and updated BrokerRequest interface

## Decisions Made
- **check2fa fails open:** On error, returns false (assumes no 2FA) since this is for detection, not security enforcement
- **authenticateOtp follows authenticate() pattern:** Same error handling, response structure, and generic error messages for consistency

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- BrokerClient now has complete 2FA support
- Ready for Plan 10-05 (login route integration) to use these methods
- check2fa() can detect 2FA requirement before prompting user
- authenticateOtp() validates codes after password auth succeeds

---
*Phase: 10-two-factor-authentication*
*Completed: 2026-01-24*
