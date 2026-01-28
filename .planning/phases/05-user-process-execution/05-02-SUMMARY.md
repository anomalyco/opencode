---
phase: 05-user-process-execution
plan: 02
subsystem: auth
tags: [process, spawn, impersonation, pty, unix, login-shell]

# Dependency graph
requires:
  - phase: 05-01
    provides: PTY allocation module (PtyPair, allocate)
provides:
  - Login environment configuration (LoginEnvironment)
  - User process spawning with privilege drop (spawn_as_user)
  - Session/controlling terminal setup
affects: [05-03, 05-04, 05-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Platform-specific constants (TIOCSCTTY for Linux vs macOS)
    - Platform-specific type casting (gid_t vs c_int for initgroups)
    - Pre-exec async-signal-safe code (no heap, no locks, no logging)
    - CString created before pre_exec for safety

key-files:
  created:
    - packages/opencode-broker/src/process/mod.rs
    - packages/opencode-broker/src/process/environment.rs
    - packages/opencode-broker/src/process/spawn.rs
  modified:
    - packages/opencode-broker/src/lib.rs

key-decisions:
  - "Platform-specific TIOCSCTTY constant (0x540E Linux, 0x20007461 macOS)"
  - "Platform-specific gid type for initgroups (gid_t Linux, c_int macOS)"
  - "Fresh environment (env_clear) to avoid root env leakage"
  - "arg0('-') for login shell indication"

patterns-established:
  - "Pre-exec closure: create CString before closure to avoid heap allocation"
  - "Platform cfg blocks for syscall differences"

# Metrics
duration: 4min
completed: 2026-01-22
---

# Phase 5 Plan 2: Process Spawner Summary

**User process spawning with UID/GID impersonation, supplementary groups via initgroups, session leader via setsid, and controlling terminal via TIOCSCTTY**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-22T07:43:41Z
- **Completed:** 2026-01-22T07:47:27Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Login environment module with clean env build (USER, LOGNAME, HOME, SHELL, TERM, PATH, OPENCODE=1)
- Process spawner with privilege impersonation via CommandExt uid/gid
- Pre-exec hook sets initgroups, setsid, TIOCSCTTY, and stdio redirection
- Platform-specific handling for macOS vs Linux differences

## Task Commits

Each task was committed atomically:

1. **Task 1: Create environment setup module** - `d384bbc9e` (feat)
2. **Task 2: Implement process spawning with impersonation** - `0b013bd5e` (feat)
3. **Task 3: Add unit tests** - (included in Tasks 1 & 2, tests pass)

## Files Created/Modified

- `packages/opencode-broker/src/process/mod.rs` - Module exports (environment, spawn)
- `packages/opencode-broker/src/process/environment.rs` - LoginEnvironment struct with build() method
- `packages/opencode-broker/src/process/spawn.rs` - SpawnConfig, SpawnError, spawn_as_user function
- `packages/opencode-broker/src/lib.rs` - Added `pub mod process;`

## Decisions Made

1. **Platform-specific TIOCSCTTY** - Linux uses 0x540E, macOS uses 0x20007461 (from respective tty header files)
2. **Platform-specific gid type for initgroups** - Linux uses gid_t (u32), macOS uses c_int (i32)
3. **Fresh environment via env_clear()** - Critical for security: prevents root environment variables from leaking into user process
4. **Login shell indication via arg0("-")** - Standard UNIX convention for login shells to read profile files

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

1. **macOS initgroups type mismatch** - macOS uses c_int for gid parameter, not gid_t. Fixed with platform-specific cfg blocks.
2. **Clippy warning on TIOCSCTTY constant test** - Removed redundant `assert!(TIOCSCTTY > 0)` as constant assertions are optimized out.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Process spawner ready for integration with IPC handler
- spawn_as_user can be called after PTY allocation
- Integration tests require root privileges (documented in module)

---

_Phase: 05-user-process-execution_
_Completed: 2026-01-22_
