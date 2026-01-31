# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-19)

**Core value:** Secure remote access to your opencode instance from anywhere — authenticate once with your system credentials, work on your projects from any device.
**Current focus:** Milestone 1 Complete - Ready for next milestone

## Current Position

**Milestone 1:** Complete (Phases 1-11)
**Phase:** 16 of 17 (Repo downloads) - In progress
**Next Phase:** 20 - Refactor 2FA verification page
**Plan:** 08 of 08 - Complete (gap closures; plans 02-03 pending)
**Status:** Phase in progress
**Last activity:** 2026-01-31 - Completed 19-02 plan

Progress: [█████████░] 96% (51/53 plans complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 43
- Average duration: 5.2 min
- Total execution time: 224.5 min

**By Phase:**

| Phase                         | Plans | Total    | Avg/Plan |
| ----------------------------- | ----- | -------- | -------- |
| 1. Configuration Foundation   | 3     | 12 min   | 4 min    |
| 2. Session Infrastructure     | 2     | 5 min    | 2.5 min  |
| 3. Auth Broker Core           | 6     | 33 min   | 5.5 min  |
| 4. Authentication Flow        | 2     | 8 min    | 4 min    |
| 5. User Process Execution     | 10    | 83 min   | 8.3 min  |
| 6. Login UI                   | 1     | 25 min   | 25 min   |
| 7. Security Hardening         | 3     | 20 min   | 6.7 min  |
| 8. Session Enhancements       | 4     | 11.5 min | 2.9 min  |
| 9. Connection Security UI     | 2     | 4.6 min  | 2.3 min  |
| 10. Two-Factor Authentication | 8     | 19.6 min | 2.5 min  |
| 11. Documentation             | 3     | 9.9 min  | 3.3 min  |

**Recent Trend:**

- Last 5 plans: 10-07 (3.3 min), 10-08 (2.5 min), 11-01 (2.9 min), 11-03 (4.2 min), 11-04 (2.8 min)
- Trend: Consistently fast execution

_Updated after each plan completion_

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

| Phase | Decision                                                       | Rationale                                                                                     |
| ----- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 01-01 | Duration strings stored as-is (not transformed)                | Matches config pattern - store config value, transform at usage                               |
| 01-01 | Type assertion for ms package                                  | TypeScript compatibility with template literal types                                          |
| 01-02 | PamServiceNotFoundError in Config namespace                    | Follows existing pattern - config errors in Config namespace                                  |
| 01-03 | PAM validation after all config merging                        | Validate final effective config, not intermediate states                                      |
| 01-03 | Startup-only PAM validation                                    | Later deletion handled at auth time, not startup                                              |
| 02-01 | In-memory session storage acceptable                           | Sessions lost on restart per CONTEXT.md design                                                |
| 02-01 | Secondary index by username                                    | O(1) removeAllForUser for "logout everywhere"                                                 |
| 02-02 | Auth middleware after cors, before Instance.provide            | Auth happens early but CORS headers still set                                                 |
| 02-02 | AuthRoutes as global routes                                    | Logout doesn't require project context                                                        |
| 02-02 | Secure cookie only on HTTPS                                    | Allows localhost dev without HTTPS                                                            |
| 03-01 | nonstick instead of pam-client                                 | pam-client fails on macOS due to OpenPAM compatibility                                        |
| 03-01 | Password redaction: Debug + skip_serializing                   | Two-layer protection against password logging                                                 |
| 03-02 | AllNumeric check before InvalidFirstChar                       | More specific error messages for numeric usernames                                            |
| 03-03 | LinesCodec 64KB max length                                     | DoS protection for IPC protocol                                                               |
| 03-03 | Socket permissions 0o666                                       | Any local user can connect, PAM handles auth                                                  |
| 03-03 | Auth flow: validate -> rate limit -> PAM                       | Fail fast on brute force before hitting PAM                                                   |
| 03-05 | existsSync check before createConnection                       | Bun throws sync error unlike Node.js async error event                                        |
| 03-05 | Settled flag pattern                                           | Prevent double-resolve/reject in promise-based socket code                                    |
| 03-04 | systemd Type=notify                                            | Broker signals readiness via sd_notify                                                        |
| 03-04 | Separate PAM configs per platform                              | Linux pam_unix, macOS pam_opendirectory                                                       |
| 04-01 | getent with dscl fallback                                      | getent works on Linux, dscl for macOS                                                         |
| 04-01 | Optional UNIX fields in UserSession                            | Backward compatible extension                                                                 |
| 04-02 | X-Requested-With header required for CSRF                      | Basic CSRF protection - browser won't add this header cross-origin                            |
| 04-02 | Generic auth_failed error on all failures                      | Prevents user enumeration attacks                                                             |
| 04-02 | returnUrl validation (starts with /, no //)                    | Prevents open redirect vulnerabilities                                                        |
| 05-01 | Platform-specific ptsname                                      | ptsname_r on Linux (thread-safe), ptsname on macOS                                            |
| 05-01 | DashMap for session management                                 | Lock-free concurrent access without async overhead                                            |
| 05-01 | Direct libc for ptsname                                        | nix ptsname requires PtyMaster, openpty returns OwnedFd                                       |
| 05-02 | Platform-specific TIOCSCTTY                                    | Linux 0x540E, macOS 0x20007461 from tty headers                                               |
| 05-02 | Platform-specific gid for initgroups                           | Linux gid_t (u32), macOS c_int (i32)                                                          |
| 05-02 | Fresh env via env_clear()                                      | Prevent root environment leaking to user process                                              |
| 05-02 | arg0("-") for login shell                                      | Standard UNIX convention for profile loading                                                  |
| 05-03 | Default terminal: xterm-256color, 80x24                        | Sensible defaults for SpawnPtyParams                                                          |
| 05-03 | session_id in SpawnPtyParams                                   | User lookup from authenticated session                                                        |
| 05-04 | RwLock for UserSessionStore                                    | Simple thread safety, reads lock-free                                                         |
| 05-04 | Response.data as serde_json::Value                             | Flexible typed results for any response                                                       |
| 05-04 | Server holds Arc refs to session stores                        | Shared across all connections                                                                 |
| 05-05 | Unregister is idempotent                                       | Logout can be called multiple times without error                                             |
| 05-05 | Session-first auth flow                                        | RegisterSession before SpawnPty ensures user info available                                   |
| 05-06 | Default PTY options: xterm-256color, 80x24                     | Sensible defaults matching common terminal emulators                                          |
| 05-06 | SpawnPty returns structured result                             | Unlike boolean methods, returns ptyId, pid, error for richer feedback                         |
| 05-07 | Fire-and-forget broker calls                                   | Registration/unregistration don't block auth flow                                             |
| 05-07 | Graceful degradation                                           | Web access works even if broker unavailable                                                   |
| 05-07 | Broker PTY path throws "not yet implemented"                   | PTY I/O streaming deferred to Plan 05-08                                                      |
| 05-08 | Broker relay approach for I/O                                  | Simplest option, reuses existing IPC infrastructure                                           |
| 05-08 | Base64 encoding for PTY data                                   | Safe transport of binary data over JSON protocol                                              |
| 05-08 | Non-blocking read for ptyRead                                  | Prevents blocking on empty PTY, returns WouldBlock gracefully                                 |
| 05-08 | Output streaming deferred                                      | Polling foundation sufficient for MVP                                                         |
| 05-09 | AuthContext interface                                          | Structured sessionId, username, uid, gid for route access                                     |
| 05-09 | Route-level auth checks                                        | Double-check auth for critical PTY operations                                                 |
| 05-09 | Conditional sessionId                                          | Pass to Pty.create only when auth enabled                                                     |
| 07-01 | Double-submit cookie pattern                                   | Stateless CSRF protection fits in-memory session design                                       |
| 07-01 | HMAC session binding                                           | Prevents token fixation attacks via signature validation                                      |
| 07-01 | Non-HttpOnly CSRF cookie                                       | Required for double-submit pattern (client reads cookie)                                      |
| 07-01 | CSRF allowlist includes /auth/login                            | Login endpoint sets initial cookie, cannot validate one                                       |
| 07-02 | IP-based rate limiting only                                    | Per user decision: simpler approach blocks single-source brute force                          |
| 07-02 | Rate limiting before PAM                                       | Protects PAM from brute force load, fails fast                                                |
| 07-02 | Default: 5 attempts per 15 min                                 | Balances security vs usability, allows typos without lockout                                  |
| 07-02 | Privacy-preserving logging                                     | Mask usernames (pe\*\*\*r) to reduce exposure in security logs                                |
| 07-03 | Localhost HTTP exemption                                       | Always allow localhost over HTTP for developer experience                                     |
| 07-03 | trustProxy controls X-Forwarded-Proto                          | Only trust proxy headers when explicitly configured                                           |
| 07-03 | sessionStorage for warning dismissal                           | Session-scoped persistence appropriate for security warnings                                  |
| 07-03 | Disabled form in block mode                                    | Clear UX - form disabled with error message when HTTPS required                               |
| 08-01 | Remember me checkbox checked by default                        | User convenience per CONTEXT.md specification                                                 |
| 08-01 | Cookie maxAge in seconds not milliseconds                      | Hono setCookie API requirement                                                                |
| 08-01 | Session timeout differentiation                                | Remember-me uses rememberMeDuration (90d), regular uses sessionTimeout (7d)                   |
| 08-01 | rememberMe defaults to false when undefined                    | Backward compatibility and explicit opt-in semantics                                          |
| 08-03 | No icon for expiration toast                                   | Icon set doesn't include clock/time icons; persistent toast with title is sufficient          |
| 08-03 | Inline styles for overlay                                      | Simple one-off component with specific z-index requirements; easier to maintain inline        |
| 08-03 | Warning shown once per expiration window                       | Prevents toast spam; user can extend or dismiss once                                          |
| 08-04 | Use Portal to render SessionIndicator in titlebar-right        | Matches existing SessionHeader pattern for titlebar integration                               |
| 08-04 | Add chevron-down icon to dropdown trigger                      | Provides visual affordance for dropdown interaction                                           |
| 08-04 | Session indicator only visible when authenticated              | Component-level auth check, no additional layout logic needed                                 |
| 09-01 | Three-state security model (secure/insecure/local)             | Distinguish between insecure connections and local development (localhost doesn't need HTTPS) |
| 09-01 | Visibility change listener for status updates                  | Detect when user switches from HTTP to HTTPS in same tab or returns after proxy configuration |
| 09-01 | Color coding scheme (green/red/blue)                           | Green for secure, red for insecure, blue for local - clear visual communication               |
| 09-02 | localStorage for banner dismissal                              | Persistent dismissal provides better UX than session-scoped re-showing warning every session  |
| 09-02 | SecurityBadge before SessionIndicator                          | Connection security status more fundamental than session info in visual hierarchy             |
| 09-02 | Banner below titlebar                                          | High visibility for security warnings without blocking critical UI                            |
| 10-01 | AuthError reuse from pam module                                | Consistent error handling across auth operations                                              |
| 10-01 | Separate PAM service for OTP validation                        | Isolate OTP-only auth from password+OTP combined auth                                         |
| 10-01 | nullok option in PAM config                                    | Graceful fallback for users without 2FA configured                                            |
| 10-02 | AuthenticateOtp uses same rate limiter as password auth        | Prevents brute force attacks on OTP codes                                                     |
| 10-02 | Check2fa returns failure response for no 2FA                   | Client checks success field to determine 2FA status                                           |
| 10-02 | OTP code redacted in Debug output                              | Follows password redaction pattern for security                                               |
| 10-03 | Added jose library to opencode package                         | Required for JWT signing/verification - already used in function package                      |
| 10-04 | check2fa fails open on error                                   | For detection-only use case, assumes no 2FA when broker unavailable                           |
| 10-04 | authenticateOtp follows authenticate() pattern                 | Consistent error handling and response structure                                              |
| 10-05 | Token secret generated once at startup via lazy initialization | Acceptable that tokens invalidate on restart, matching session design                         |
| 10-05 | 2FA token bound to requesting IP                               | Security measure to prevent token theft                                                       |
| 10-05 | Device trust cookie uses httpOnly, Strict SameSite             | Security best practices for sensitive cookies                                                 |
| 10-05 | 2FA login does not use rememberMe for session                  | Device trust is separate concept from session persistence                                     |
| 10-06 | escapeHtml helper for username                                 | XSS prevention when displaying user-provided data                                             |
| 10-06 | Auto-submit only for 6-digit codes                             | Backup codes may be longer, user should manually submit those                                 |
| 10-07 | QR code as inline SVG                                          | No external image hosting needed, renders directly in HTML                                    |
| 10-07 | Custom base32 encoder                                          | Standard RFC 4648 base32, no extra dependency needed                                          |
| 10-07 | Show google-authenticator CLI command                          | User must run server command to enable PAM OTP validation                                     |
| 10-08 | Device trust cookie cleared on all logout paths                | Consistency - both /logout and /logout/all clear trust                                        |
| 10-08 | Status endpoint verifies cookie validity                       | Prevents false positives for device trust status                                              |
| 10-08 | 2FA setup opens in new tab                                     | Placeholder URL for future setup page                                                         |
| 11-01 | Document both nginx and Caddy as primary reverse proxy options | nginx is widely used and enterprise-proven, Caddy has automatic HTTPS                         |
| 11-01 | 24-hour WebSocket timeout for proxy configurations             | Prevents long-running terminal sessions from being disconnected                               |
| 11-01 | Placeholder pattern for user-supplied values                   | Clear indication of values users must replace, prevents copy-paste errors                     |
| 11-04 | docs/README.md as documentation hub                            | Central discovery point for all auth documentation, standard pattern for project docs         |
| 11-04 | Quick start in 5 steps                                         | New users need fastest path to working auth, reduces time-to-first-success                    |
| 11-04 | Architecture diagram in index                                  | Visual overview helps users understand component relationships before diving in               |
| 11-04 | Main README links to ./docs/                                   | GitHub landing page must lead to deployment docs without searching                            |

### Roadmap Evolution

- Phase 12 added: Server-Side TOTP Registration - offload .google_authenticator file generation to server
- Phase 13 added: Passkeys Investigation - investigate adding passkeys and passkey management to opencode auth
- Phase 14 added: Persistent Session Storage - add persistent session storage for multi-instance deployments
- Phase 15 added: Update docs to use opencode fork (pRizz) - point documentation to https://github.com/pRizz/opencode which has the auth implementation
- Phase 16 added: Allow the user to download git repos so that they can work on them with their opencode sessions
- Phase 17 added: Make the client boundary the only place where "unknown" exists, then validate and normalize into strict types so the rest of the UI can't represent invalid shapes. Concrete pattern: Typed API layer: Expose functions like findFiles(): Promise<string[]> (no { data }, no unknown), and only allow those in UI code. Don't export the raw SDK client outside this layer. Runtime validation: Parse server responses with a schema (zod, valibot, io-ts). If validation fails, throw or return a typed error. This makes "wrong shape" impossible to flow into components. Normalization at the boundary: If the SDK can return { data } or raw arrays, normalize there and return the canonical type. No any/unknown past boundary: The rest of the app should only see string[] or a typed error union. This fully applies "illegal states unrepresentable": UI code can't accidentally access .map on a non-array because it never sees non-array values.
- Phase 18 added: Audit all server routes for if they need authentication checks
- Phase 19 added: Refactor auth login page (replace string-based login HTML with a SolidJS-based page)
- Phase 20 added: Refactor 2FA verification page (move generate2FAPageHtml content into packages/app)

### Pending Todos

- Fix site manifest 401
- Fix web terminal 500
- Support Cloudflare Quick Tunnel

### Blockers/Concerns

From research summary (Phase 2, 3 flags):

- Bun N-API compatibility with PAM libraries needs runtime verification
- PTY ownership with user impersonation via bun-pty needs testing

**Resolved:**

- macOS PAM crate compatibility - resolved by using nonstick instead of pam-client
- PTY allocation on macOS - working with platform-specific ptsname
- macOS initgroups type - resolved with platform-specific gid type casting

## Session Continuity

Last session: 2026-01-31 21:25:02Z
Stopped at: Completed 19-02-PLAN.md
Resume file: None
Next: Finish Phase 16 plans 02-03, then proceed to Phase 17

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
- [x] Plan 02: HTTP warning banner and layout integration (2.1 min)

## Phase 10 Progress

**Two-Factor Authentication - Complete:**

- [x] Plan 01: 2FA config and OTP module (4.7 min)
- [x] Plan 02: Broker protocol 2FA extension (2.3 min)
- [x] Plan 03: Token utilities (2.7 min)
- [x] Plan 04: BrokerClient 2FA methods (2 min)
- [x] Plan 05: Auth Routes 2FA Flow (3 min)
- [x] Plan 06: 2FA Verification Page UI (2.4 min)
- [x] Plan 07: 2FA Setup Wizard (3.3 min)
- [x] Plan 08: Device Trust Management (2.5 min)

Verification: Passed (4/4 must-haves verified)

## Phase 11 Progress

**Documentation - Complete:**

- [x] Plan 01: Reverse proxy documentation (nginx, Caddy, TLS, security headers) (2.9 min)
- [x] Plan 02: PAM configuration documentation (4.2 min)
- [x] Plan 03: Troubleshooting guide with flowcharts (2.8 min)
- [x] Plan 04: Documentation index and integration (2.8 min)

Verification: All documentation discoverable from GitHub landing page
UAT: Passed (5/5 tests) - 2026-01-26

## Phase 19 Progress

**Refactor auth login page - Complete:**

- [x] Plan 01: SolidJS login entry and Vite multi-page build
- [x] Plan 02: Auth route serves Solid login HTML with security context
