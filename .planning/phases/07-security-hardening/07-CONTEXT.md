# Phase 7: Security Hardening - Context

**Gathered:** 2026-01-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Protect login and state-changing operations against common web attacks. Implement CSRF protection, rate limiting on login attempts, HTTP/HTTPS detection with warnings, and configurable security behaviors. Does not include 2FA (Phase 10), session enhancements (Phase 8), or UI security indicators beyond login page (Phase 9).

</domain>

<decisions>
## Implementation Decisions

### CSRF Protection
- Double-submit cookie pattern — token in cookie + request header/body, stateless
- Validate on all state-changing requests (POST, PUT, DELETE, PATCH)
- Accept token via both header (X-CSRF-Token) and request body field — supports forms and API calls
- Skip CSRF when auth is disabled — no auth means local/trusted use
- WebSocket connections require CSRF token in URL param on initial handshake
- Cookie is readable by JavaScript (non-HttpOnly) — required for double-submit pattern
- Token lifetime tied to session — rotates when session expires or logs out
- Regenerate token after successful login — prevents session fixation
- Cookie name: `opencode_csrf` — matches existing naming pattern
- Config allowlist for routes that skip CSRF — flexibility for integrations/webhooks
- Configurable verbose error setting (default false) — developers can enable detailed CSRF failure messages for debugging

### Claude's Discretion (CSRF)
- Token verification method (string match vs HMAC-signed) — Claude picks appropriate security level

### Rate Limiting
- Rate limit login attempts only — focused protection
- Track by IP address only — simpler approach, blocks single-source brute force
- Configurable limits with sensible default — admin can tune for their environment
- On limit exceeded: 429 response with both Retry-After header and human-readable message

### HTTP Warning Behavior
- Detection: Check X-Forwarded-Proto header first, fall back to direct protocol — handles both proxied and direct connections
- Warning only by default — show warning but allow login, user decides to proceed
- Optional `require_https` config setting — admin can enable strict mode to block HTTP login
- Warning appears on login form only — users see it before entering credentials

### Error Messaging
- Rate limit message: Claude decides on time disclosure vs generic message
- Server-side logging: Detailed logging of security events (IP, username, failure reason, timestamp) — helps admins investigate
- When HTTPS required but HTTP used: Show login form with disabled inputs and block message explaining HTTPS required
- HTTP warning is dismissible with "I understand" acknowledgment — explicit user acceptance of risk

</decisions>

<specifics>
## Specific Ideas

- CSRF cookie name follows existing `opencode_session` naming convention
- Rate limiting should have sensible defaults that work for internet-exposed servers
- Verbose error mode helps developers debug without exposing information to attackers in production

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-security-hardening*
*Context gathered: 2026-01-22*
