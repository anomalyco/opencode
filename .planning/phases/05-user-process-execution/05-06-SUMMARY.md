---
phase: 05-user-process-execution
plan: 06
subsystem: api
tags: [typescript, ipc, broker-client, pty, session]

# Dependency graph
requires:
  - phase: 05-04
    provides: PTY handler with spawn/resize/kill support
  - phase: 05-05
    provides: Session registration protocol in broker
provides:
  - TypeScript client methods for all broker IPC operations
  - UserInfo, SpawnPtyResult, SpawnPtyOptions interfaces
  - Session registration and PTY management API
affects: [05-09, 06-terminal-websocket]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Request/response pattern with ID verification for all methods
    - Graceful error handling returning false/error message

key-files:
  modified:
    - packages/opencode/src/auth/broker-client.ts

key-decisions:
  - "All methods return boolean/result for error handling"
  - "SpawnPty returns structured result with ptyId, pid, error"
  - "Default PTY options: xterm-256color, 80x24"

patterns-established:
  - "BrokerClient method pattern: generate ID, build request, sendRequest, verify response ID"

# Metrics
duration: 1min
completed: 2026-01-22
---

# Phase 5 Plan 6: TypeScript BrokerClient Extension Summary

**Extended BrokerClient with session registration (registerSession, unregisterSession) and PTY management (spawnPty, killPty, resizePty) methods**

## Performance

- **Duration:** 1 min
- **Started:** 2026-01-22T11:27:37Z
- **Completed:** 2026-01-22T11:29:26Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Added registerSession method to register user info with broker after authentication
- Added unregisterSession method for logout cleanup
- Added spawnPty method returning ptyId and pid on success
- Added killPty and resizePty methods for PTY lifecycle management
- Exported UserInfo, SpawnPtyResult, SpawnPtyOptions interfaces
- Added comprehensive JSDoc with @param, @returns, @example for all methods

## Task Commits

Each task was committed atomically:

1. **Tasks 1-3: Session registration, PTY methods, JSDoc** - `cfafa079b` (feat)
   - All three tasks were implemented cohesively in a single commit as they form a unified API extension

**Note:** Tasks were combined because:

- Task 1 required interface updates that Task 2 also needed
- Task 2 built directly on Task 1's patterns
- Task 3 (JSDoc) was done inline with implementation

## Files Created/Modified

- `packages/opencode/src/auth/broker-client.ts` - Extended from 226 to 512 lines with new methods and interfaces

## Decisions Made

1. **All methods follow same pattern** - Generate UUID, build request, sendRequest, verify response ID matches
2. **SpawnPty returns structured result** - Unlike boolean methods, spawnPty returns SpawnPtyResult with ptyId, pid, or error
3. **Default PTY options** - term: "xterm-256color", cols: 80, rows: 24, env: {} (sensible defaults)
4. **Graceful error handling** - All methods catch exceptions and return false/error instead of throwing

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BrokerClient now has complete API for session and PTY operations
- Ready for Plan 07 (Signal forwarding) or Plan 09 (Client PTY API)
- All exported types match broker protocol

---

_Phase: 05-user-process-execution_
_Completed: 2026-01-22_
