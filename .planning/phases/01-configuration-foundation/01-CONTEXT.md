# Phase 1: Configuration Foundation - Context

**Gathered:** 2026-01-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Auth configuration schema integrated into opencode.json with backward-compatible defaults. Users can enable/configure PAM authentication through the standard config file. Validation ensures safe startup. No authentication flow yet — just the configuration layer.

</domain>

<decisions>
## Implementation Decisions

### Config Structure
- Top-level `"auth"` key in opencode.json
- Method-aware structure: `{ "auth": { "method": "pam", "pam": {...} } }` — extensible for future auth methods
- Just "pam" method for now, add others when needed
- Comprehensive fields: enabled, sessionTimeout, rememberMeDuration, requireHttps, rateLimiting, allowedUsers, sessionPersistence
- Duration values as human-readable strings: "30m", "1h", "7d"
- PAM service name configurable: `pam: { service: "opencode" }`
- Optional allowedUsers: if omitted/empty, any system user can log in; if present, only listed users
- Rate limiting as simple boolean (enabled/disabled) — sensible internal defaults
- requireHttps as three modes: "off", "warn", "block"
- sessionTimeout and rememberMeDuration as separate top-level fields (not nested under session)
- sessionPersistence as boolean for controlling session survival across restarts
- Cookie signing secret auto-generated if missing, stored in-memory only (regenerates on restart)
- No environment variable overrides — all config via opencode.json
- JSON Schema file + human docs for config documentation

### Validation Behavior
- Validation at startup only (not on config file changes)
- Invalid auth config = fatal error, refuse to start
- Check PAM service file exists at startup, fail if missing with actionable guidance
- Provide both: manual instructions + offer automated setup if running as root
- Trust X-Forwarded-Proto header for reverse proxy detection (follow best practices)
- Optional trustProxy config flag for explicit control
- No duration bounds checking — trust user to set sensible values

### Default Values
- sessionTimeout: "7d" (7 days)
- rememberMeDuration: "90d" (90 days)
- requireHttps: "warn"
- rateLimiting: true (enabled by default)
- pam.service: "opencode"
- allowedUsers: [] (empty = any system user)
- sessionPersistence: true (persist to disk)

### Error Messages
- Detailed + suggestion format: field, issue, AND suggested fix
- Stop at first error (not all-at-once)
- PAM service file missing: full inline setup guide with example content
- Auto-detect terminal for colors/formatting (plain in pipes/logs)

### Claude's Discretion
- Exact internal rate limiting parameters (attempts, lockout duration, decay)
- Session storage format/location when persistence enabled
- Specific X-Forwarded-Proto security validation logic
- JSON Schema structure and field descriptions

</decisions>

<specifics>
## Specific Ideas

- Error messages should be helpful enough that a user can fix the issue without searching docs
- PAM service file creation should be as low-friction as possible — show the exact commands
- Cookie secret in-memory is acceptable since session persistence handles user convenience

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-configuration-foundation*
*Context gathered: 2026-01-19*
