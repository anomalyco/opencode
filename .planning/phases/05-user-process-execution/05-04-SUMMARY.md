---
phase: 05-user-process-execution
plan: 04
subsystem: pty
tags: [pty, ipc, spawn, signal, ioctl, session]

# Dependency graph
requires:
  - phase: 05-01
    provides: PTY allocation module (allocator::allocate)
  - phase: 05-02
    provides: Process spawning module (spawn::spawn_as_user)
  - phase: 05-03
    provides: IPC protocol extension (SpawnPty, KillPty, ResizePty methods)
provides:
  - Functional PTY handlers wired to allocation and spawn modules
  - Session-to-user mapping storage (UserSessionStore)
  - Response data field for returning SpawnPtyResult
affects: [05-05, 05-06, 05-07, 05-08, 05-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Session-to-user lookup pattern via UserSessionStore
    - Response with optional data payload for typed results

key-files:
  created:
    - packages/opencode-broker/src/session/mod.rs
    - packages/opencode-broker/src/session/user.rs
  modified:
    - packages/opencode-broker/src/ipc/handler.rs
    - packages/opencode-broker/src/ipc/server.rs
    - packages/opencode-broker/src/ipc/protocol.rs
    - packages/opencode-broker/src/pty/session.rs
    - packages/opencode-broker/src/lib.rs

key-decisions:
  - "RwLock for UserSessionStore - simple thread safety, reads lock-free"
  - "Response.data as serde_json::Value - flexible typed results"
  - "Server holds Arc references to session stores - shared across connections"

patterns-established:
  - "Session lookup: user_sessions.get(session_id) for user info before PTY ops"
  - "Response with data: success_with_data() for returning typed results"

# Metrics
duration: 4min
completed: 2026-01-22
---

# Phase 05 Plan 04: PTY Handler Implementation Summary

**Wired PTY handlers to PTY allocation and process spawning modules, making spawn/kill/resize functional via IPC**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-22T11:14:52Z
- **Completed:** 2026-01-22T11:19:16Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Created session module with UserSessionStore for mapping web session IDs to UNIX user info
- Implemented SpawnPty handler that looks up user, allocates PTY, spawns shell, returns pty_id/pid
- Implemented KillPty handler that sends SIGTERM and removes session
- Implemented ResizePty handler that uses TIOCSWINSZ ioctl to change dimensions
- Added Response.data field for returning typed results (SpawnPtyResult)
- Updated server to create and share UserSessionStore and SessionManager across connections

## Task Commits

Each task was committed atomically:

1. **Task 1: Add session-to-user mapping storage** - `29edc96d3` (feat)
2. **Task 2+3: Implement SpawnPty, KillPty, ResizePty handlers** - `534fd161c` (feat)

## Files Created/Modified

- `packages/opencode-broker/src/session/mod.rs` - Session module declaration
- `packages/opencode-broker/src/session/user.rs` - UserInfo struct and UserSessionStore with register/get/remove/remove_by_user
- `packages/opencode-broker/src/ipc/handler.rs` - Full implementations of handle_spawn_pty, handle_kill_pty, handle_resize_pty
- `packages/opencode-broker/src/ipc/server.rs` - Added user_sessions and pty_sessions Arc fields, getters, and connection handler updates
- `packages/opencode-broker/src/ipc/protocol.rs` - Added Response.data field and success_with_data() method
- `packages/opencode-broker/src/pty/session.rs` - Added From<String> and From<&str> impls for PtyId
- `packages/opencode-broker/src/lib.rs` - Added pub mod session

## Decisions Made

1. **RwLock for UserSessionStore** - Simple thread safety with lock-free reads; sufficient for expected concurrency pattern
2. **Response.data as serde_json::Value** - Flexible enough to carry any typed result (SpawnPtyResult, future result types)
3. **Server holds Arc references** - UserSessionStore and SessionManager shared across all connections via Arc
4. **Tasks 2+3 combined into one commit** - Both handler implementations logically related, tested together

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All PTY handlers now functional
- Ready for Plan 05: I/O multiplexing (reading/writing PTY data)
- UserSessionStore ready for web server integration after authentication
- Server exposes user_sessions() and pty_sessions() for external access

---
*Phase: 05-user-process-execution*
*Completed: 2026-01-22*
