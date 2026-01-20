# Phase 3: Auth Broker Core - Context

**Gathered:** 2026-01-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Privileged auth broker daemon that handles PAM authentication via Unix socket IPC. The broker runs as a separate process with elevated privileges, accepts auth requests from the unprivileged opencode web server, validates credentials against PAM, and returns success/failure. User process spawning is handled separately in Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Broker Architecture
- **Lifecycle:** Long-running daemon, started at boot (not on-demand spawning)
- **Startup:** systemd service on Linux, launchd on macOS (research needed for exact approach)
- **Concurrency:** Claude's discretion — research PAM threading constraints to determine fork-per-request vs thread pool
- **Scope:** Authentication only — returns success/fail, does not spawn user processes
- **Config source:** Reads opencode.json (same config file as opencode)
- **Multi-client:** Shared broker serves multiple opencode instances on the same machine
- **Installation:** `opencode auth setup` command handles privileged setup (setuid, service registration)
- **Binary location:** Same directory as opencode preferred, but Claude researches platform-specific best practices
- **Privilege level:** Run as root for simplicity (Claude to validate this approach in research)
- **Hot reload:** Not supported — restart required for config changes
- **Logging:** Authentication attempts logged to syslog
- **Health check:** Supports ping command via IPC

### IPC Protocol
- **Format:** JSON over Unix socket (newline-delimited)
- **Style:** Request-response only (no streaming)
- **Multiplexing:** Request IDs for concurrent requests on single connection
- **Error format:** Generic "authentication failed" only — no detailed error codes (prevents user enumeration)
- **Operations:** Authenticate only (plus ping for health check)
- **Auth response:** Success/fail boolean only — no UID/GID in response (web server looks up separately)
- **Timeout:** Both broker-enforced max timeout AND client-configurable timeout
- **Versioning:** Protocol version included in every message

### Security Model
- **Socket access:** Any local user can connect (relies on PAM for actual auth)
- **Client validation:** None — any process can send auth requests
- **Rate limiting:** Per-username rate limiting on failed attempts (broker-side)
- **Credential logging:** Never log passwords, even in debug mode
- **PAM service:** Dedicated /etc/pam.d/opencode service file
- **Input validation:** Strict username validation (reject special chars, max length)
- **Privilege drop:** Stay root (simpler than capabilities approach)

### Implementation Language
- **Language:** Rust (memory safe, excellent for privileged code)
- **PAM bindings:** Use pam crate (research to verify maintenance status)
- **Code location:** Monorepo subfolder (packages/opencode-broker)
- **Async runtime:** Tokio
- **Cross-compilation:** Native builds only (build on target platform)
- **Distribution:** Compile from source, integrated into npm/crates.io install process (research how to trigger Rust build during npm install)
- **Testing:** Mock PAM in unit tests (no real PAM calls in CI)

### Claude's Discretion
- Exact concurrency model (fork vs threads) based on PAM constraints
- macOS authentication backend (PAM vs OpenDirectory — research needed)
- Socket path location per platform
- Rate limiting thresholds and backoff strategy
- Exact username validation rules
- Error message wording

</decisions>

<specifics>
## Specific Ideas

- "I want it to feel like Cockpit's auth broker — similar proven pattern"
- Multi-platform support is critical: Linux and macOS must both work
- Future Windows support is a possibility (note for architecture decisions)
- Installation should be part of the opencode install flow, not a separate manual step

</specifics>

<deferred>
## Deferred Ideas

- User process spawning — Phase 5
- Windows support — future milestone

</deferred>

---

*Phase: 03-auth-broker-core*
*Context gathered: 2026-01-20*
