---
phase: 05-user-process-execution
plan: 05
subsystem: ipc
tags: [ipc, session, protocol, rust]

requires:
  - phase: 05-03
    provides: IPC protocol extension (SpawnPty, KillPty, ResizePty)
  - phase: 05-04
    provides: UserSessionStore for session-to-user mapping
provides:
  - RegisterSession IPC method for session registration after login
  - UnregisterSession IPC method for session cleanup on logout
  - Complete session lifecycle management for PTY spawning
affects: [05-09, 06-web-server]

tech-stack:
  added: []
  patterns:
    - "Idempotent unregister (succeeds even if not found)"
    - "Session-first authentication flow"

key-files:
  created: []
  modified:
    - packages/opencode-broker/src/ipc/protocol.rs
    - packages/opencode-broker/src/ipc/handler.rs

key-decisions:
  - "Unregister is idempotent - returns success even if session not found"
  - "Session info stored before PTY spawn (register-then-spawn flow)"

patterns-established:
  - "Session registration protocol: web server calls RegisterSession after PAM auth, broker stores user info for SpawnPty lookup"

duration: 3 min
completed: 2026-01-22
---

# Phase 5 Plan 5: Session Registration Protocol Summary

**IPC protocol extended with RegisterSession/UnregisterSession for web server to register authenticated users before PTY spawning**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-22T11:21:31Z
- **Completed:** 2026-01-22T11:24:XX Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added RegisterSession and UnregisterSession method variants to IPC protocol
- Implemented handlers that store/remove user info in UserSessionStore
- Added comprehensive tests verifying storage behavior and idempotent unregister
- Enabled complete session lifecycle: login -> RegisterSession -> SpawnPty -> UnregisterSession -> logout

## Task Commits

Each task was committed atomically:

1. **Task 1: Add RegisterSession and UnregisterSession to protocol** - `b7509d98` (feat)
2. **Task 2: Implement session registration handlers** - `6ffe5da3` (feat)
3. **Task 3: Add handler tests for session registration** - `a40f7e8c` (test)

## Files Created/Modified

- `packages/opencode-broker/src/ipc/protocol.rs` - Added RegisterSession, UnregisterSession methods and param structs
- `packages/opencode-broker/src/ipc/handler.rs` - Added handle_register_session and handle_unregister_session handlers plus tests

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Unregister returns success even if session not found | Idempotent operations are safer - logout can be called multiple times without error |
| RegisterSession stores clone of user info | UserInfo is cheap to clone, avoids lifetime complexity |

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Session registration protocol complete
- Web server can now: authenticate via PAM -> RegisterSession with user info -> SpawnPty with session_id -> UnregisterSession on logout
- Ready for Plan 06: Window resize handling (I/O multiplexing was moved up)

---
*Phase: 05-user-process-execution*
*Completed: 2026-01-22*
