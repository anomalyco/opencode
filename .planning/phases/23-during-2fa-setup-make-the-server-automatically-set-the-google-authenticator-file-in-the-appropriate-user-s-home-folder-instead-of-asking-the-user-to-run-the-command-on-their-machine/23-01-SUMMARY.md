---
phase: 23-during-2fa-setup-make-the-server-automatically-set-the-google-authenticator-file-in-the-appropriate-user-s-home-folder-instead-of-asking-the-user-to-run-the-command-on-their-machine
plan: 01
subsystem: broker
tags: [broker, auth, 2fa, otp, ipc, rust]

# Dependency graph
requires: []
provides:
  - Broker IPC method to write ~/.google_authenticator for a session user
  - Structured setup status codes for 2FA auto-provisioning
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Atomic creation of ~/.google_authenticator with permissions and ownership
    - IPC response payload with setup status codes

key-files:
  created: []
  modified:
    - packages/opencode-broker/src/auth/otp.rs
    - packages/opencode-broker/src/auth/mod.rs
    - packages/opencode-broker/src/ipc/protocol.rs
    - packages/opencode-broker/src/ipc/handler.rs

key-decisions:
  - "Use broker session_id lookup to avoid passing uid/gid/home over IPC."
  - "Return explicit setup status codes for manual fallback."

patterns-established:
  - "OTP setup write flow mirrors PTY session user lookup and uses structured error codes."

# Metrics
duration: 30 min
completed: 2026-01-31
---

# Phase 23 Plan 01 Summary

**The broker can now create ~/.google_authenticator for a session user via a dedicated IPC method.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-01-31T18:10:00Z
- **Completed:** 2026-01-31T18:40:00Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Added an atomic writer for the google_authenticator file with ownership and 0400 permissions.
- Introduced a new `setupotp` IPC method and structured response payloads.
- Wired broker handling to resolve session users and return status codes for auto-setup.
- Added unit tests for file creation, invalid homes, and existing file handling.

## Task Commits

No task commits were created (commits were not requested).

## Files Created/Modified

- `packages/opencode-broker/src/auth/otp.rs` - Added file writer, error types, and tests.
- `packages/opencode-broker/src/auth/mod.rs` - Re-exported OTP setup helpers.
- `packages/opencode-broker/src/ipc/protocol.rs` - Added `setupotp` method, params, and result type.
- `packages/opencode-broker/src/ipc/handler.rs` - Implemented setup handler and status mapping.

## Decisions Made

None - followed plan as specified.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

Ready to wire auto-setup status into the server setup route and UI.

---

_Phase: 23-during-2fa-setup-make-the-server-automatically-set-the-google-authenticator-file-in-the-appropriate-user-s-home-folder-instead-of-asking-the-user-to-run-the-command-on-their-machine_
_Completed: 2026-01-31_
