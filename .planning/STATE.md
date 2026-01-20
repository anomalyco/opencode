# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-19)

**Core value:** Secure remote access to your opencode instance from anywhere — authenticate once with your system credentials, work on your projects from any device.
**Current focus:** Phase 4 (Authentication Flow) - Plan 02 Complete

## Current Position

Phase: 4 of 11 (Authentication Flow)
Plan: 2 of 3 in current phase
Status: In progress
Last activity: 2026-01-20 - Completed 04-02-PLAN.md

Progress: [██████░░░░] ~60%

## Performance Metrics

**Velocity:**
- Total plans completed: 14
- Average duration: 4.1 min
- Total execution time: 58 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Configuration Foundation | 3 | 12 min | 4 min |
| 2. Session Infrastructure | 2 | 5 min | 2.5 min |
| 3. Auth Broker Core | 6 | 33 min | 5.5 min |
| 4. Authentication Flow | 2 | 8 min | 4 min |

**Recent Trend:**
- Last 5 plans: 03-05 (3 min), 03-06 (8 min), 04-01 (4 min), 04-02 (4 min)
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01-01 | Duration strings stored as-is (not transformed) | Matches config pattern - store config value, transform at usage |
| 01-01 | Type assertion for ms package | TypeScript compatibility with template literal types |
| 01-02 | PamServiceNotFoundError in Config namespace | Follows existing pattern - config errors in Config namespace |
| 01-03 | PAM validation after all config merging | Validate final effective config, not intermediate states |
| 01-03 | Startup-only PAM validation | Later deletion handled at auth time, not startup |
| 02-01 | In-memory session storage acceptable | Sessions lost on restart per CONTEXT.md design |
| 02-01 | Secondary index by username | O(1) removeAllForUser for "logout everywhere" |
| 02-02 | Auth middleware after cors, before Instance.provide | Auth happens early but CORS headers still set |
| 02-02 | AuthRoutes as global routes | Logout doesn't require project context |
| 02-02 | Secure cookie only on HTTPS | Allows localhost dev without HTTPS |
| 03-01 | nonstick instead of pam-client | pam-client fails on macOS due to OpenPAM compatibility |
| 03-01 | Password redaction: Debug + skip_serializing | Two-layer protection against password logging |
| 03-02 | AllNumeric check before InvalidFirstChar | More specific error messages for numeric usernames |
| 03-03 | LinesCodec 64KB max length | DoS protection for IPC protocol |
| 03-03 | Socket permissions 0o666 | Any local user can connect, PAM handles auth |
| 03-03 | Auth flow: validate -> rate limit -> PAM | Fail fast on brute force before hitting PAM |
| 03-05 | existsSync check before createConnection | Bun throws sync error unlike Node.js async error event |
| 03-05 | Settled flag pattern | Prevent double-resolve/reject in promise-based socket code |
| 03-04 | systemd Type=notify | Broker signals readiness via sd_notify |
| 03-04 | Separate PAM configs per platform | Linux pam_unix, macOS pam_opendirectory |
| 04-01 | getent with dscl fallback | getent works on Linux, dscl for macOS |
| 04-01 | Optional UNIX fields in UserSession | Backward compatible extension |
| 04-02 | X-Requested-With header required for CSRF | Basic CSRF protection - browser won't add this header cross-origin |
| 04-02 | Generic auth_failed error on all failures | Prevents user enumeration attacks |
| 04-02 | returnUrl validation (starts with /, no //) | Prevents open redirect vulnerabilities |

### Pending Todos

None yet.

### Blockers/Concerns

From research summary (Phase 2, 3 flags):
- Bun N-API compatibility with PAM libraries needs runtime verification
- PTY ownership with user impersonation via bun-pty needs testing

**Resolved:**
- macOS PAM crate compatibility - resolved by using nonstick instead of pam-client

## Session Continuity

Last session: 2026-01-20
Stopped at: Completed 04-02-PLAN.md
Resume file: None
Next: 04-03-PLAN.md (Integration tests)

## Phase 4 Progress

**Authentication Flow - IN PROGRESS:**
- [x] Plan 01: User info lookup module and session extension (4 min, 10 tests)
- [x] Plan 02: Login endpoint (4 min, 17 tests)
- [ ] Plan 03: Integration tests
