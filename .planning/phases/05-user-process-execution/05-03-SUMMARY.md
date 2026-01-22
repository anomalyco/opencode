---
phase: 05-user-process-execution
plan: 03
subsystem: ipc
tags: [ipc, pty, protocol, serde, rust]

# Dependency graph
requires:
  - phase: 03-auth-broker-core
    provides: IPC protocol foundation (Request, Response, Method enum)
provides:
  - SpawnPty, KillPty, ResizePty method types
  - PTY parameter structs for IPC requests
  - SpawnPtyResult response type
  - Stub handlers ready for implementation
affects: [05-04-session-lifecycle, 05-05-io-multiplexing, 05-09-client-pty-api]

# Tech tracking
tech-stack:
  added: []
  patterns: [stub handlers returning "not implemented", default serde values]

key-files:
  modified:
    - packages/opencode-broker/src/ipc/protocol.rs
    - packages/opencode-broker/src/ipc/handler.rs

key-decisions:
  - "Default terminal values: xterm-256color, 80x24"
  - "session_id in SpawnPtyParams for user lookup"
  - "Stub handlers return informative error messages"

# Metrics
duration: 6 min
completed: 2026-01-22
---

# Phase 5 Plan 3: IPC Protocol Extension Summary

**Extended IPC protocol with SpawnPty, KillPty, ResizePty methods and stub handlers for PTY management**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-22T05:08:00Z
- **Completed:** 2026-01-22T05:14:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Extended Method enum with SpawnPty, KillPty, ResizePty variants
- Added parameter structs with sensible defaults (xterm-256color, 80x24)
- Added SpawnPtyResult response type with pty_id and pid
- Implemented stub handlers that log params and return "not implemented"
- Added comprehensive tests for serialization and handler dispatch

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PTY method types to IPC protocol** - `62c20770` (feat)
   - Note: Included minimal handler changes needed for compilation
2. **Task 3: Add handler tests for PTY methods** - `bc606154` (test)

**Plan metadata:** (pending)

## Files Created/Modified

- `packages/opencode-broker/src/ipc/protocol.rs` - Extended with PTY method types, param structs, result type
- `packages/opencode-broker/src/ipc/handler.rs` - Added stub handlers and dispatch logic

## Decisions Made

1. **Default terminal settings** - xterm-256color with 80 cols x 24 rows as sensible defaults
2. **session_id for user lookup** - SpawnPtyParams includes session_id to look up authenticated user
3. **Informative stub errors** - Stubs return method-specific "not implemented" messages

## Deviations from Plan

None - plan executed exactly as written.

Note: Task 1 and Task 2 were combined into a single commit because protocol changes require handler match statement updates to compile. This is expected Rust behavior with exhaustive enum matching.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- IPC protocol now supports PTY management methods
- Stub handlers ready to be implemented with actual PTY logic
- Plan 05-04 (Session lifecycle) can now wire these handlers to the PTY/spawn modules

---
*Phase: 05-user-process-execution*
*Completed: 2026-01-22*
