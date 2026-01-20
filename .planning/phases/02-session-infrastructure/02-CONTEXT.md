# Phase 2: Session Infrastructure - Context

**Gathered:** 2026-01-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Secure session cookies with configurable expiration and logout capability. Users can log in (via Phase 4), stay logged in across requests, log out, and sessions expire after idle timeout. Session storage, cookie mechanics, and logout flow are in scope. Login UI and "remember me" are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Session storage
- In-memory storage (Map or similar structure)
- Sessions lost on server restart — acceptable trade-off for simplicity
- No limit on concurrent sessions per user
- Session IDs generated via cryptographic random (crypto.randomUUID or equivalent)

### Timeout behavior
- Idle timeout only (no absolute timeout)
- Any authenticated API request resets the idle timer
- On session expiry, redirect to login page (silent redirect on next request)
- Session expiry warning deferred to Phase 8 (Session Enhancements)

### Logout flow
- Offer both "Logout" (current session) and "Logout everywhere" (all sessions) options
- POST /auth/logout endpoint only — no GET to prevent CSRF logout
- Redirect to login page after logout
- No confirmation dialog — immediate logout

### Cookie configuration
- Cookie name: `opencode_session`
- Path: `/` (root)
- HttpOnly: true
- SameSite: Strict
- Secure: true for HTTPS, omit for localhost/HTTP (allows local dev)
- Domain: not explicitly set (browser default — exact host)

### Claude's Discretion
- Session store implementation details (Map vs custom class)
- Exact middleware structure
- Error handling for malformed session cookies
- Session ID length/format beyond "cryptographically random"

</decisions>

<specifics>
## Specific Ideas

- Follow Cockpit model — simple session handling that works with system authentication
- Sessions are just an in-memory mapping; real identity comes from the UNIX user (Phase 4)

</specifics>

<deferred>
## Deferred Ideas

- Session expiry warning ("Session expiring soon") — Phase 8
- Session activity indicator showing time remaining — Phase 8
- "Remember me" extended session lifetime — Phase 8
- Session persistence across restarts — could be added later if needed

</deferred>

---

*Phase: 02-session-infrastructure*
*Context gathered: 2026-01-20*
