---
phase: 05-user-process-execution
plan: 01
subsystem: pty
tags: [pty, nix, openpty, dashmap, uuid, session-management]

# Dependency graph
requires:
  - phase: 03-auth-broker-core
    provides: auth broker infrastructure
provides:
  - PTY allocation via openpty with chown to target user
  - Session state tracking with unique IDs
  - Thread-safe SessionManager using DashMap
affects: [05-02-PLAN, 05-03-PLAN]

# Tech tracking
tech-stack:
  added: [libc, uuid, dashmap]
  patterns: [platform-specific ptsname, RAII OwnedFd, newtype pattern for IDs]

key-files:
  created:
    - packages/opencode-broker/src/pty/mod.rs
    - packages/opencode-broker/src/pty/allocator.rs
    - packages/opencode-broker/src/pty/session.rs
  modified:
    - packages/opencode-broker/Cargo.toml
    - packages/opencode-broker/src/lib.rs

key-decisions:
  - "Platform-specific ptsname: ptsname_r on Linux, ptsname on macOS"
  - "DashMap for thread-safe concurrent session access"
  - "Direct libc calls for ptsname instead of nix wrapper"

patterns-established:
  - "OwnedFd for automatic FD cleanup on drop"
  - "PtyId newtype wrapper for type-safe session identification"
  - "SessionManager with get_by_user for user logout cleanup"

# Metrics
duration: 40min
completed: 2026-01-22
---

# Phase 5 Plan 1: PTY Allocation Summary

**PTY allocation module with openpty, slave chown to target user, and thread-safe session tracking via DashMap**

## Performance

- **Duration:** 40 min
- **Started:** 2026-01-22T06:58:37Z
- **Completed:** 2026-01-22T07:38:12Z
- **Tasks:** 2 (tests included inline)
- **Files modified:** 5

## Accomplishments

- PTY allocation via nix::pty::openpty with automatic chown of slave device
- Platform-specific ptsname handling (thread-safe ptsname_r on Linux, ptsname on macOS)
- Session state tracking with PtyId (UUID v4) and PtySession struct
- Thread-safe SessionManager using DashMap for concurrent access
- Unit tests for both allocator and session manager (skip gracefully without root)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PTY allocator module** - `8ba6917d0` (feat)
2. **Task 2: Add PTY session state tracking** - `a1276f425` (feat)

Note: Task 3 (unit tests) was combined with Tasks 1 and 2 as tests were added alongside implementation.

## Files Created/Modified

- `packages/opencode-broker/src/pty/mod.rs` - Module exports for allocator and session
- `packages/opencode-broker/src/pty/allocator.rs` - PTY allocation with openpty and chown
- `packages/opencode-broker/src/pty/session.rs` - Session state tracking with DashMap
- `packages/opencode-broker/Cargo.toml` - Added nix features (term, fs), libc, uuid, dashmap
- `packages/opencode-broker/src/lib.rs` - Export pty module

## Decisions Made

| Decision                    | Rationale                                                     |
| --------------------------- | ------------------------------------------------------------- |
| Platform-specific ptsname   | nix 0.29 ptsname_r only on Linux; direct libc for portability |
| DashMap over RwLock+HashMap | Lock-free concurrent access without async overhead            |
| Direct libc for ptsname     | nix::pty::ptsname requires PtyMaster, openpty returns OwnedFd |
| Tests skip on EPERM         | PTY allocation tests need root for chown to different user    |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] nix pty feature doesn't exist in 0.29**

- **Found during:** Task 1 (PTY allocator implementation)
- **Issue:** Plan specified `pty` feature but nix 0.29 uses `term` feature for PTY
- **Fix:** Changed feature from `pty` to `term` in Cargo.toml
- **Files modified:** packages/opencode-broker/Cargo.toml
- **Verification:** cargo check passes
- **Committed in:** 8ba6917d0

**2. [Rule 3 - Blocking] nix ptsname requires PtyMaster, not OwnedFd**

- **Found during:** Task 1 (PTY allocator implementation)
- **Issue:** openpty returns OwnedFd but ptsname requires PtyMaster newtype
- **Fix:** Added direct libc calls for ptsname/ptsname_r with platform-specific code
- **Files modified:** packages/opencode-broker/src/pty/allocator.rs, Cargo.toml (add libc)
- **Verification:** cargo check passes, tests pass
- **Committed in:** 8ba6917d0

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both auto-fixes were necessary due to nix crate API structure. No scope creep.

## Issues Encountered

- nix 0.29 API mismatch: openpty returns OwnedFd but ptsname functions expect PtyMaster
- Resolved by using direct libc calls with platform-specific implementations

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PTY allocation foundation complete
- Ready for Plan 02 (process spawner)
- Session state tracking ready for child process PID association

---

_Phase: 05-user-process-execution_
_Completed: 2026-01-22_
