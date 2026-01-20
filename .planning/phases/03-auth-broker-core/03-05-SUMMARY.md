---
phase: 03-auth-broker-core
plan: 05
subsystem: auth
tags: [typescript, ipc, unix-socket, broker-client, bun]

# Dependency graph
requires:
  - phase: 03-auth-broker-core
    provides: IPC protocol types (Request, Response) in Rust broker
provides:
  - TypeScript BrokerClient for auth IPC
  - Platform-aware Unix socket connection
  - Graceful error handling with generic messages
affects: [04-web-server]

# Tech tracking
tech-stack:
  added: []
  patterns: [newline-delimited JSON client, existsSync fast-fail for missing sockets]

key-files:
  created:
    - packages/opencode/src/auth/broker-client.ts
    - packages/opencode/test/auth/broker-client.test.ts
  modified:
    - packages/opencode/src/auth/index.ts

key-decisions:
  - "existsSync check before createConnection: Bun throws sync error unlike Node.js async error event"
  - "Settled flag pattern: Prevent double-resolve/reject in promise-based socket code"

patterns-established:
  - "Socket existence check before connection in Bun runtime"
  - "Generic error messages for auth failures (no internal details)"

# Metrics
duration: 3min
completed: 2026-01-20
---

# Phase 03 Plan 05: Broker Client Summary

**TypeScript IPC client for auth broker with Unix socket connection, newline-delimited JSON protocol, and 12-test suite**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-20T19:18:57Z
- **Completed:** 2026-01-20T19:22:11Z
- **Tasks:** 3
- **Files created:** 2
- **Files modified:** 1

## Accomplishments

- BrokerClient class with authenticate() and ping() methods
- Platform-aware default socket paths (Linux: /run, macOS: /var/run)
- 12 unit tests with mock Unix socket server
- Error handling returns generic messages (no internal details exposed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create broker client module** - `7f5ded6` (feat)
2. **Task 2: Create auth module barrel export** - `58bbb72` (feat)
3. **Task 3: Add broker client tests** - `7374977` (test)

Additional commits:
- **Bug fix: Bun socket error handling** - `2f93426` (fix)

## Files Created/Modified

- `packages/opencode/src/auth/broker-client.ts` - BrokerClient class for Unix socket IPC
- `packages/opencode/src/auth/index.ts` - Re-export BrokerClient and AuthResult
- `packages/opencode/test/auth/broker-client.test.ts` - 12 unit tests with mock server

## Decisions Made

1. **existsSync check before createConnection** - Bun's runtime throws synchronous errors for ENOENT on createConnection, unlike Node.js which emits async error events. Fast-fail check prevents uncaught exceptions.

2. **Settled flag pattern** - Promise-based socket code can have multiple code paths resolve/reject. Using a `settled` boolean prevents double-settlement race conditions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Bun socket error handling**
- **Found during:** Task 3 (testing)
- **Issue:** Test "returns error when broker not running" was failing with uncaught ENOENT error
- **Root cause:** Bun throws sync error on createConnection to non-existent socket, Node.js would emit async error event
- **Fix:** Added existsSync check before createConnection to fast-fail gracefully
- **Files modified:** packages/opencode/src/auth/broker-client.ts
- **Verification:** All 12 tests pass
- **Committed in:** 2f93426

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for Bun runtime compatibility. No scope creep.

## Issues Encountered

None beyond the Bun compatibility issue documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BrokerClient ready for use in login endpoint
- Protocol matches Rust broker exactly (verified by tests)
- Ready for Phase 4: Web server integration with login route

---
*Phase: 03-auth-broker-core*
*Completed: 2026-01-20*
