---
phase: 05-user-process-execution
plan: 08
subsystem: pty
tags: [pty, ipc, base64, broker, websocket]

requires:
  - phase: 05-07
    provides: Web server integration with broker session registration
provides:
  - Broker-backed PTY session management module
  - PtyWrite and PtyRead IPC methods in broker
  - TypeScript BrokerClient I/O methods
  - Input writing via broker relay
affects: [05-09-client-pty-api, 05-10-integration-tests]

tech-stack:
  added: [base64]
  patterns: [broker-relay-io, base64-binary-transport]

key-files:
  created:
    - packages/opencode/src/pty/broker-pty.ts
  modified:
    - packages/opencode/src/pty/index.ts
    - packages/opencode/src/auth/broker-client.ts
    - packages/opencode-broker/src/ipc/protocol.rs
    - packages/opencode-broker/src/ipc/handler.rs
    - packages/opencode-broker/Cargo.toml

key-decisions:
  - "Broker relay approach for I/O (simplest, works with existing IPC)"
  - "Base64 encoding for binary data over JSON IPC"
  - "Non-blocking read with O_NONBLOCK for ptyRead"
  - "Output streaming marked as TODO (polling foundation only)"

patterns-established:
  - "BrokerPty as separate module from local Pty namespace"
  - "Base64 encode/decode for PTY data transport"
  - "Forget file handle after fd operations to prevent close"

duration: 4min
completed: 2026-01-22
---

# Phase 5 Plan 8: Broker PTY I/O Summary

**Broker-backed PTY I/O with base64-encoded data transport over IPC relay**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-22T11:35:36Z
- **Completed:** 2026-01-22T11:39:XX
- **Tasks:** 3 (2 committed - Task 3 was completed in Task 1)
- **Files modified:** 6

## Accomplishments

- Created broker-pty.ts module for managing broker-spawned PTY sessions
- Added PtyWrite/PtyRead IPC methods to Rust broker with base64 encoding
- Added ptyWrite/ptyRead methods to TypeScript BrokerClient
- Wired WebSocket input to ptyWrite in connect handler
- Established polling foundation for output (streaming deferred)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create broker-pty module with TypeScript client I/O** - `0259f59` (feat)
2. **Task 2: Add PtyWrite/PtyRead IPC methods to broker** - `4517014` (feat)

Note: Task 3 (wire ptyWrite/ptyRead) was completed as part of Task 1 - the connect handler was wired to use ptyWrite during the initial module creation.

## Files Created/Modified

- `packages/opencode/src/pty/broker-pty.ts` - New module for broker-backed PTY sessions
- `packages/opencode/src/pty/index.ts` - Export BrokerPty module
- `packages/opencode/src/auth/broker-client.ts` - Add ptyWrite/ptyRead methods
- `packages/opencode-broker/src/ipc/protocol.rs` - Add PtyWrite/PtyRead methods and params
- `packages/opencode-broker/src/ipc/handler.rs` - Implement handle_pty_write/handle_pty_read
- `packages/opencode-broker/Cargo.toml` - Add base64 dependency

## Decisions Made

| Decision                  | Rationale                                                       |
| ------------------------- | --------------------------------------------------------------- |
| Broker relay approach     | Simplest option, reuses existing IPC infrastructure             |
| Base64 encoding for data  | Safe transport of binary data over JSON protocol                |
| Non-blocking read         | Prevents blocking on empty PTY, returns WouldBlock gracefully   |
| Output streaming deferred | Polling foundation sufficient for MVP, streaming is future work |
| Separate BrokerPty module | Clean separation from local Pty namespace                       |

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation followed plan smoothly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Broker PTY I/O foundation complete
- Input writing works via ptyWrite relay
- Output reading has polling support (ptyRead)
- Ready for Plan 09 (Client PTY API) to expose these capabilities
- Output streaming (push-based) deferred to future enhancement

**Note:** The current implementation provides polling-based read. For production efficiency, a push mechanism (broker -> web server) would be better, but the polling foundation allows basic functionality.

---

_Phase: 05-user-process-execution_
_Completed: 2026-01-22_
