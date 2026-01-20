---
phase: 03-auth-broker-core
plan: 02
subsystem: auth
tags: [rust, pam, nonstick, governor, rate-limiting, validation, posix]

# Dependency graph
requires:
  - phase: 03-01
    provides: opencode-broker Cargo project with nonstick PAM crate
provides:
  - PAM authentication wrapper with thread-per-request model
  - Per-username rate limiting with governor crate
  - POSIX-compliant username validation
affects: [03-03, broker-integration]

# Tech tracking
tech-stack:
  added: [governor]
  patterns: [thread-per-request for PAM, keyed rate limiting]

key-files:
  created:
    - packages/opencode-broker/src/auth/mod.rs
    - packages/opencode-broker/src/auth/pam.rs
    - packages/opencode-broker/src/auth/rate_limit.rs
    - packages/opencode-broker/src/auth/validation.rs
  modified:
    - packages/opencode-broker/src/lib.rs

key-decisions:
  - "AllNumeric check before InvalidFirstChar for specific error messages"

patterns-established:
  - "Thread-per-request for PAM: Each auth spawns dedicated std::thread with oneshot channel"
  - "Generic auth errors: Map all PAM errors to 'authentication failed' to prevent user enumeration"
  - "Per-username rate limiting: Create limiter on first attempt, cleanup stale entries"

# Metrics
duration: 5min
completed: 2026-01-20
---

# Phase 3 Plan 2: Auth Components Summary

**PAM wrapper with thread-per-request model, per-username rate limiting using governor, and POSIX username validation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-20T19:13:12Z
- **Completed:** 2026-01-20T19:17:46Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- PAM authentication via nonstick crate with dedicated thread per request
- Generic error messages to prevent user enumeration attacks
- Rate limiting with configurable attempts per minute using governor crate
- POSIX-compliant username validation blocking path traversal and injection

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PAM authentication wrapper** - `d25cd7a` (feat)
2. **Task 2: Create per-username rate limiter** - `46a1a69` (feat)
3. **Task 3: Create username validation** - `4c5bacb` (feat)

## Files Created/Modified

- `packages/opencode-broker/src/auth/mod.rs` - Module exports for auth components
- `packages/opencode-broker/src/auth/pam.rs` - PAM auth with thread-per-request pattern
- `packages/opencode-broker/src/auth/rate_limit.rs` - Keyed rate limiter with cleanup
- `packages/opencode-broker/src/auth/validation.rs` - POSIX username validation
- `packages/opencode-broker/src/lib.rs` - Added auth module export

## Decisions Made

- **AllNumeric check order:** Moved AllNumeric check before InvalidFirstChar to give more specific error messages for pure numeric usernames (otherwise digits fail InvalidFirstChar first)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **governor clock type:** `wait_time_from()` requires governor's `QuantaInstant` not `std::time::Instant` - fixed by using `DefaultClock::default().now()`
- **Test expectations:** Some validation tests expected different errors (e.g., "123" expected AllNumeric but got InvalidFirstChar) - fixed by reordering validation checks

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Auth components complete: PAM wrapper, rate limiter, validation
- Ready for Plan 03: Unix socket server integration
- All components tested (44 tests total in broker package)

---
*Phase: 03-auth-broker-core*
*Completed: 2026-01-20*
