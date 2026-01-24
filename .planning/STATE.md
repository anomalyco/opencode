# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-19)

**Core value:** Secure remote access to your opencode instance from anywhere — authenticate once with your system credentials, work on your projects from any device.
**Current focus:** Phase 9 (Connection Security UI) - In progress

## Current Position

Phase: 9 of 11 (Connection Security UI)
Plan: 1 of 1 in Phase 9 - Complete
Status: Phase 9 Plan 01 complete
Last activity: 2026-01-24 - Completed 09-01-PLAN.md

Progress: [████████░░] ~74%

## Performance Metrics

**Velocity:**
- Total plans completed: 31
- Average duration: 6.0 min
- Total execution time: 190 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Configuration Foundation | 3 | 12 min | 4 min |
| 2. Session Infrastructure | 2 | 5 min | 2.5 min |
| 3. Auth Broker Core | 6 | 33 min | 5.5 min |
| 4. Authentication Flow | 2 | 8 min | 4 min |
| 5. User Process Execution | 10 | 83 min | 8.3 min |
| 6. Login UI | 1 | 25 min | 25 min |
| 7. Security Hardening | 3 | 20 min | 6.7 min |
| 8. Session Enhancements | 4 | 11.5 min | 2.9 min |
| 9. Connection Security UI | 1 | 2.5 min | 2.5 min |

**Recent Trend:**
- Last 5 plans: 08-01 (4 min), 08-02 (2 min), 08-03 (3.5 min), 08-04 (2 min), 09-01 (2.5 min)
- Trend: Fast UI-focused execution

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
| 05-09 | AuthContext interface | Structured sessionId, username, uid, gid for route access |
| 05-09 | Route-level auth checks | Double-check auth for critical PTY operations |
| 05-09 | Conditional sessionId | Pass to Pty.create only when auth enabled |
| 07-01 | Double-submit cookie pattern | Stateless CSRF protection fits in-memory session design |
| 07-01 | HMAC session binding | Prevents token fixation attacks via signature validation |
| 07-01 | Non-HttpOnly CSRF cookie | Required for double-submit pattern (client reads cookie) |
| 07-01 | CSRF allowlist includes /auth/login | Login endpoint sets initial cookie, cannot validate one |
| 07-02 | IP-based rate limiting only | Per user decision: simpler approach blocks single-source brute force |
| 07-02 | Rate limiting before PAM | Protects PAM from brute force load, fails fast |
| 07-02 | Default: 5 attempts per 15 min | Balances security vs usability, allows typos without lockout |
| 07-02 | Privacy-preserving logging | Mask usernames (pe***r) to reduce exposure in security logs |
| 07-03 | Localhost HTTP exemption | Always allow localhost over HTTP for developer experience |
| 07-03 | trustProxy controls X-Forwarded-Proto | Only trust proxy headers when explicitly configured |
| 07-03 | sessionStorage for warning dismissal | Session-scoped persistence appropriate for security warnings |
| 07-03 | Disabled form in block mode | Clear UX - form disabled with error message when HTTPS required |
| 08-01 | Remember me checkbox checked by default | User convenience per CONTEXT.md specification |
| 08-01 | Cookie maxAge in seconds not milliseconds | Hono setCookie API requirement |
| 08-01 | Session timeout differentiation | Remember-me uses rememberMeDuration (90d), regular uses sessionTimeout (7d) |
| 08-01 | rememberMe defaults to false when undefined | Backward compatibility and explicit opt-in semantics |
| 08-03 | No icon for expiration toast | Icon set doesn't include clock/time icons; persistent toast with title is sufficient |
| 08-03 | Inline styles for overlay | Simple one-off component with specific z-index requirements; easier to maintain inline |
| 08-03 | Warning shown once per expiration window | Prevents toast spam; user can extend or dismiss once |
| 08-04 | Use Portal to render SessionIndicator in titlebar-right | Matches existing SessionHeader pattern for titlebar integration |
| 08-04 | Add chevron-down icon to dropdown trigger | Provides visual affordance for dropdown interaction |
| 08-04 | Session indicator only visible when authenticated | Component-level auth check, no additional layout logic needed |
| 09-01 | Three-state security model (secure/insecure/local) | Distinguish between insecure connections and local development (localhost doesn't need HTTPS) |
| 09-01 | Visibility change listener for status updates | Detect when user switches from HTTP to HTTPS in same tab or returns after proxy configuration |
| 09-01 | Color coding scheme (green/red/blue) | Green for secure, red for insecure, blue for local - clear visual communication |

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

Last session: 2026-01-24
Stopped at: Completed 09-01-PLAN.md
Resume file: None
Next: Verify Phase 9 (Connection Security UI) UAT and continue to Phase 10

## Phase 6 Progress

**Login UI - Complete:**
- [x] Plan 01: Login page with form, password toggle, styling (25 min)

## Phase 7 Progress

**Security Hardening - Complete:**
- [x] Plan 01: CSRF Protection (6 min)
- [x] Plan 02: Rate Limiting (8 min)
- [x] Plan 03: HTTPS Detection (6 min)

## Phase 8 Progress

**Session Enhancements - Complete:**
- [x] Plan 01: Remember me functionality (4 min)
- [x] Plan 02: Session context and username indicator (2 min)
- [x] Plan 03: Session expiration warnings (3.5 min)
- [x] Plan 04: Session indicator integration (2 min)

## Phase 9 Progress

**Connection Security UI - Complete:**
- [x] Plan 01: Security badge component with connection status (2.5 min)
