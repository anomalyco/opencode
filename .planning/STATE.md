# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-19)

**Core value:** Secure remote access to your opencode instance from anywhere — authenticate once with your system credentials, work on your projects from any device.
**Current focus:** Phase 5 (User Process Execution) - In Progress

## Current Position

Phase: 5 of 11 (User Process Execution)
Plan: 8 of 10 in current phase
Status: In progress
Last activity: 2026-01-22 - Completed 05-08-PLAN.md

Progress: [████████░░] ~85%

## Performance Metrics

**Velocity:**
- Total plans completed: 22
- Average duration: 5.5 min
- Total execution time: 122 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Configuration Foundation | 3 | 12 min | 4 min |
| 2. Session Infrastructure | 2 | 5 min | 2.5 min |
| 3. Auth Broker Core | 6 | 33 min | 5.5 min |
| 4. Authentication Flow | 2 | 8 min | 4 min |
| 5. User Process Execution | 8 | 64 min | 8 min |

**Recent Trend:**
- Last 5 plans: 05-05 (3 min), 05-06 (1 min), 05-07 (2 min), 05-08 (4 min)
- Trend: I/O implementation slightly longer, but still fast

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
| 05-01 | Platform-specific ptsname | ptsname_r on Linux (thread-safe), ptsname on macOS |
| 05-01 | DashMap for session management | Lock-free concurrent access without async overhead |
| 05-01 | Direct libc for ptsname | nix ptsname requires PtyMaster, openpty returns OwnedFd |
| 05-02 | Platform-specific TIOCSCTTY | Linux 0x540E, macOS 0x20007461 from tty headers |
| 05-02 | Platform-specific gid for initgroups | Linux gid_t (u32), macOS c_int (i32) |
| 05-02 | Fresh env via env_clear() | Prevent root environment leaking to user process |
| 05-02 | arg0("-") for login shell | Standard UNIX convention for profile loading |
| 05-03 | Default terminal: xterm-256color, 80x24 | Sensible defaults for SpawnPtyParams |
| 05-03 | session_id in SpawnPtyParams | User lookup from authenticated session |
| 05-04 | RwLock for UserSessionStore | Simple thread safety, reads lock-free |
| 05-04 | Response.data as serde_json::Value | Flexible typed results for any response |
| 05-04 | Server holds Arc refs to session stores | Shared across all connections |
| 05-05 | Unregister is idempotent | Logout can be called multiple times without error |
| 05-05 | Session-first auth flow | RegisterSession before SpawnPty ensures user info available |
| 05-06 | Default PTY options: xterm-256color, 80x24 | Sensible defaults matching common terminal emulators |
| 05-06 | SpawnPty returns structured result | Unlike boolean methods, returns ptyId, pid, error for richer feedback |
| 05-07 | Fire-and-forget broker calls | Registration/unregistration don't block auth flow |
| 05-07 | Graceful degradation | Web access works even if broker unavailable |
| 05-07 | Broker PTY path throws "not yet implemented" | PTY I/O streaming deferred to Plan 05-08 |
| 05-08 | Broker relay approach for I/O | Simplest option, reuses existing IPC infrastructure |
| 05-08 | Base64 encoding for PTY data | Safe transport of binary data over JSON protocol |
| 05-08 | Non-blocking read for ptyRead | Prevents blocking on empty PTY, returns WouldBlock gracefully |
| 05-08 | Output streaming deferred | Polling foundation sufficient for MVP |

### Pending Todos

None yet.

### Blockers/Concerns

From research summary (Phase 2, 3 flags):
- Bun N-API compatibility with PAM libraries needs runtime verification
- PTY ownership with user impersonation via bun-pty needs testing

**Resolved:**
- macOS PAM crate compatibility - resolved by using nonstick instead of pam-client
- PTY allocation on macOS - working with platform-specific ptsname
- macOS initgroups type - resolved with platform-specific gid type casting

## Session Continuity

Last session: 2026-01-22
Stopped at: Completed 05-08-PLAN.md
Resume file: None
Next: 05-09-PLAN.md - Client PTY API

## Phase 5 Progress

**User Process Execution - In Progress:**
- [x] Plan 01: PTY allocation module (40 min, 7 tests)
- [x] Plan 02: Process spawner (4 min, 8 tests)
- [x] Plan 03: IPC extension for spawn (6 min, 14+4 tests)
- [x] Plan 04: PTY handler implementation (4 min, 8 tests)
- [x] Plan 05: Session registration protocol (3 min, 3 tests)
- [x] Plan 06: TypeScript BrokerClient extension (1 min)
- [x] Plan 07: Web server integration (2 min)
- [x] Plan 08: Broker PTY I/O (4 min, 7 new tests)
- [ ] Plan 09: Client PTY API
- [ ] Plan 10: Integration test harness
