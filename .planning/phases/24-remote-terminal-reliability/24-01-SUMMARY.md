---
phase: 24-remote-terminal-reliability
plan: 01
subsystem: api
tags: [pty, logging, request-id, broker, terminal, solidjs]

# Dependency graph
requires:
  - phase: 05-user-process-execution
    provides: PTY/broker session flow and routes
provides:
  - Request-scoped PTY error responses with requestId/code
  - Correlated server/PTy/broker logging for PTY lifecycle
  - UI requestId surfacing and retry markers for PTY failures
affects: [24-02, remote-terminal-reliability, terminal-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [Request-scoped logging with requestId propagation, Stable error code payloads for PTY failures]

key-files:
  created: []
  modified:
    - packages/opencode/src/server/routes/pty.ts
    - packages/opencode/src/pty/index.ts
    - packages/opencode/src/pty/broker-pty.ts
    - packages/opencode/src/auth/broker-client.ts
    - packages/app/src/context/terminal.tsx
    - packages/app/src/components/terminal.tsx
    - packages/app/src/pages/session.tsx
    - packages/app/src/components/session/session-sortable-terminal-tab.tsx

key-decisions:
  - "Attach requestId to PTY create/connect errors without changing success payloads."
  - "Mark failed PTY tabs for retry visibility rather than auto-recreating sessions."

patterns-established:
  - "PTY requestId generated in routes and passed through server/client logging."
  - "Error payloads include code + requestId for UI/log correlation."

# Metrics
duration: 6m 45s
completed: 2026-02-01
---

# Phase 24 Plan 01 Summary

**Request-scoped PTY diagnostics with correlated server/broker logs and UI error surfacing for create/connect failures.**

## Performance

- **Duration:** 6m 45s
- **Started:** 2026-02-01T21:21:25Z
- **Completed:** 2026-02-01T21:28:10Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Added requestId-bearing PTY create/connect error responses and server logs for correlation
- Propagated requestId/sessionId/ptyId into PTY and broker lifecycle logging
- Surfaced PTY failure request ids in UI with retry-marked tabs

## Task Commits

Each task was committed atomically:

1. **Task 1: Add request-scoped logging for PTY lifecycle** - `0dee4a2a9` (feat)
2. **Task 2: Surface request id in terminal UI errors** - `5e1a87257` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/opencode/src/server/routes/pty.ts` - requestId error shaping and PTY route logging
- `packages/opencode/src/pty/index.ts` - request-scoped PTY create/connect logging
- `packages/opencode/src/pty/broker-pty.ts` - broker PTY lifecycle logs with sessionId/ptyId
- `packages/opencode/src/auth/broker-client.ts` - broker PTY request logging for spawn/kill/resize
- `packages/app/src/context/terminal.tsx` - PTY error parsing and status tracking
- `packages/app/src/components/terminal.tsx` - requestId on websocket connect and UI error logging
- `packages/app/src/pages/session.tsx` - mark PTY tabs on connect errors
- `packages/app/src/components/session/session-sortable-terminal-tab.tsx` - retry indicator in tab labels

## Decisions Made
- Included requestId and code in PTY error payloads while keeping success responses unchanged.
- Marked failed terminals for retry visibility instead of automatic recreation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Diagnostics in place for PTY failure triage; ready to align broker PTY lifecycle in 24-02.

---
*Phase: 24-remote-terminal-reliability*
*Completed: 2026-02-01*
