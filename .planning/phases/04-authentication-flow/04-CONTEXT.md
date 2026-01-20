# Phase 4: Authentication Flow - Context

**Gathered:** 2026-01-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Login endpoint that validates UNIX credentials via the broker and creates a user session. Users can submit username/password, credentials are validated against PAM, and successful login creates a session mapped to UNIX UID/GID.

**Not in scope:** Login UI (Phase 6), full CSRF protection (Phase 7), rate limiting (Phase 7).

</domain>

<decisions>
## Implementation Decisions

### Login endpoint design
- Accept both JSON and form POST (detect via Content-Type header)
- Path: `POST /auth/login` (consistent with existing `/auth/logout`, `/auth/session`)
- Return JSON with user info on success: `{"success": true, "user": {...}}` + Set-Cookie
- Require `X-Requested-With` header for basic CSRF protection (full CSRF in Phase 7)
- Add `GET /auth/status` endpoint returning `{"enabled": true/false, "method": "pam"}` for UI to check if auth is enabled

### Session data
- Store full user info: UID, GID, username, home directory, shell
- `/auth/session` endpoint returns full user info for UI display
- Session extends existing infrastructure from Phase 2

### Error responses
- Include machine-readable error code: `{"error": "auth_failed", "message": "Authentication failed"}`
- Match existing opencode API error format (inspect and follow)

### Post-login redirect
- Support `returnUrl` query parameter in login request
- Validate same-origin only (reject absolute URLs or different hosts)
- Middleware captures original URL before redirecting unauthenticated users
- Pass via query parameter: `/login?returnUrl=/original/path`
- Already-authenticated users visiting login page redirect to returnUrl or `/`

### Claude's Discretion
- Supplementary groups (all GIDs) vs primary GID only — based on Phase 5 needs
- Schema approach: extend UserSession vs new AuthenticatedSession type
- Error granularity: how much to distinguish broker errors vs auth failures
- HTTP status codes for different failure types
- Force re-authentication mechanism (if any)

</decisions>

<specifics>
## Specific Ideas

- Endpoint path based on existing codebase patterns: `/auth/login` matches existing `/auth/logout`, `/auth/session`
- X-Requested-With header provides basic CSRF protection until Phase 7 adds full token-based CSRF

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-authentication-flow*
*Context gathered: 2026-01-20*
