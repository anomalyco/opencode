# Project Research Summary

**Project:** Opencode System Authentication
**Domain:** PAM-based web authentication with multi-user command execution
**Researched:** 2026-01-19
**Confidence:** MEDIUM

## Executive Summary

Adding PAM-based system authentication to opencode requires implementing a **privileged broker architecture** where authentication and process spawning are handled by a root-owned component separate from the web server. This is fundamentally different from typical web authentication because the goal is not just "who is this user?" but "run this command as this user." The Cockpit project provides the canonical reference implementation for this pattern, and our research strongly recommends following their architectural approach.

The recommended approach is a two-component design: the existing Hono server runs unprivileged and handles HTTP/session cookies, while a new "auth broker" (setuid helper binary) handles PAM authentication and spawns user processes with correct UID/GID. This separation is non-negotiable from a security perspective. Running the web server as root to simplify PAM access would create catastrophic security exposure where any web vulnerability becomes a full root compromise.

Key risks center on privilege management and PAM integration complexity. The auth broker must be implemented carefully (likely in C or Rust for minimal attack surface), PAM conversation functions must handle all message types correctly, and session tokens must use cryptographically secure generation. Bun's native module compatibility with existing PAM libraries is uncertain, which reinforces the setuid helper approach over direct PAM library integration.

## Key Findings

### Recommended Stack

The existing Hono/Bun/TypeScript stack remains unchanged for the web layer. Hono 4.10.7 provides all necessary middleware (signed cookies, CSRF protection, secure headers) without new dependencies. Session IDs can use the existing ULID library or crypto.randomBytes for stronger guarantees.

**Core technologies:**
- **Hono (existing)**: HTTP handling, session cookies, CSRF protection — built-in middleware covers all web security needs
- **Setuid helper binary (new)**: PAM authentication, process spawning — written in C/Rust for privilege separation
- **Unix socket IPC**: Communication between web server and auth broker — more secure than TCP, supports file descriptor passing

**Technologies NOT to use:**
- authenticate-pam / node-linux-pam: Native bindings with uncertain Bun compatibility, no privilege separation
- JWT for sessions: Cannot be invalidated server-side, overkill for single-server deployment
- Passport.js: Heavy, designed for OAuth, poor Hono alignment

### Expected Features

**Must have (table stakes):**
- Username/password login form with UNIX credentials
- PAM authentication backend (supports LDAP/Kerberos transparently)
- Secure session cookies (HttpOnly, Secure, SameSite=Strict)
- Logout functionality with server-side session invalidation
- Session timeout with configurable idle expiry
- HTTPS requirement warning (detect insecure, warn before login)
- CSRF protection for login form and state-changing operations
- Session-to-UID mapping so commands execute as authenticated user

**Should have (competitive):**
- "Remember me" persistent sessions for trusted devices
- Multi-session awareness (list/revoke active sessions)
- Session activity indicator showing time remaining
- Automatic session refresh while tab is active
- 2FA support via TOTP (PAM can delegate to pam_google_authenticator)

**Defer (v2+):**
- SSH key authentication (complex, useful for automation)
- Privilege escalation UI (sudo prompts for admin actions)
- Fine-grained app permissions (use UNIX permissions instead)
- OAuth/SSO (PAM already supports enterprise SSO via LDAP/Kerberos)

### Architecture Approach

The architecture follows a strict privilege separation model with three tiers: unprivileged web server, privileged auth broker, and user-context processes. The web server handles HTTP, serves static assets, and manages session cookies but never touches PAM or spawns processes directly. The auth broker receives credentials via Unix socket, performs PAM authentication, creates session entries mapping tokens to UIDs, and spawns processes with correct setuid/setgid. User processes execute actual commands under the authenticated user's identity with correct HOME, USER, SHELL environment.

**Major components:**
1. **Hono Server (unprivileged)** — HTTP handling, session cookies, route dispatch; runs as nobody/daemon
2. **Auth Broker (root/setuid)** — PAM authentication, session-UID mapping, process spawning; minimal attack surface
3. **Session Store** — File-based (SQLite/JSON) in root-owned directory with 0600 permissions
4. **User Process** — Spawned commands running as target UID/GID with correct environment

### Critical Pitfalls

1. **Running web server as root** — Any web vulnerability becomes root compromise. Prevent via strict privilege separation: unprivileged web server, separate setuid helper for PAM and spawning.

2. **PAM conversation function misuse** — Incorrect handling of PAM message types leads to auth bypass or memory corruption. Prevent by handling all 4 message types (echo on/off, error, text info), using established wrappers, implementing timeouts.

3. **Session token predictability** — Weak tokens enable session hijacking. Prevent via crypto.randomBytes(32), minimum 256 bits of entropy, never reuse tokens.

4. **Credentials in logs/memory** — Passwords appearing in logs or error messages. Prevent via explicit redaction before logging, generic error messages ("invalid credentials" not "password mismatch"), clear memory immediately after PAM call.

5. **Command injection via user input** — User-controlled input reaching shell commands. Prevent via array-based spawn (never shell=true with user input), parameter sanitization; note opencode already has tree-sitter parsing in bash tool.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Session Middleware Foundation
**Rationale:** Session infrastructure must exist before any authentication can be tested. This phase builds the foundation without touching PAM complexity.
**Delivers:** Session cookie middleware, in-memory session store (stub), session-aware API routes, login/logout routes with mock auth, session expiration logic
**Addresses:** Session cookies, logout, session timeout (partial)
**Avoids:** Over-engineering storage before auth works

### Phase 2: Auth Broker Core
**Rationale:** The privileged component is the highest-complexity, highest-risk element. Building it early allows parallel UI development and integration testing.
**Delivers:** Auth broker daemon structure, Unix socket IPC protocol, PAM integration, file-based session store, basic spawn capability
**Uses:** Setuid helper (C/Rust), Unix socket pattern, PAM service file
**Implements:** Auth broker component, session store
**Avoids:** Running web server as root, PAM conversation bugs, weak session tokens

### Phase 3: User Process Spawning
**Rationale:** Depends on auth broker existing. Completes the "run as user" capability that is the core value proposition.
**Delivers:** PTY creation with UID/GID, broker-mediated command execution, process I/O proxying, process lifecycle management
**Uses:** Existing Pty.create() extended with UID/GID parameters
**Implements:** User process component, tool execution routing
**Avoids:** Command injection, privilege escalation

### Phase 4: Login UI and Security Hardening
**Rationale:** UI can be developed in parallel once API contracts exist. Security hardening adds defense-in-depth after core flow works.
**Delivers:** SolidJS login form, HTTPS detection/warning, audit logging, rate limiting on login, session refresh on activity
**Addresses:** Login form, HTTPS warning, brute-force protection, CSRF protection (complete)
**Avoids:** User enumeration via timing, credentials over HTTP, missing cookie attributes

### Phase 5: Multi-User Polish
**Rationale:** Polish features after core functionality is secure and working.
**Delivers:** User-scoped data directories, session isolation verification, reverse proxy documentation, opencode.json configuration, graceful degradation (auth disabled = current behavior)
**Addresses:** Remember me, multi-session awareness, session activity indicator

### Phase Ordering Rationale

- **Sessions before PAM**: Testing auth flow end-to-end with mock users validates middleware before introducing PAM complexity
- **Broker before UI**: The broker defines API contracts; UI depends on them, not vice versa
- **Spawning after broker**: Cannot spawn as user without working session-to-UID mapping
- **Security hardening after core flow**: Defense-in-depth adds layers; getting the happy path right first reduces rework
- **Polish last**: Features like "remember me" extend working session management, don't change it

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Auth Broker Core):** Bun N-API compatibility with PAM libraries needs runtime verification; may determine C vs Rust vs Bun FFI for helper
- **Phase 3 (User Process Spawning):** PTY ownership with user impersonation via bun-pty needs testing; may need bun-pty modifications

Phases with standard patterns (skip research-phase):
- **Phase 1 (Session Middleware):** Hono cookie middleware is well-documented, existing codebase patterns apply
- **Phase 4 (Login UI):** Standard SolidJS form, existing app patterns apply
- **Phase 5 (Multi-User Polish):** Configuration and documentation, no novel patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (web), MEDIUM (helper) | Hono middleware verified in codebase; PAM library compatibility unverified |
| Features | MEDIUM | Based on Cockpit patterns from training data; should verify against current Cockpit docs |
| Architecture | HIGH | Privilege separation is well-established Unix security pattern; Cockpit validates approach |
| Pitfalls | HIGH | Standard security practices (OWASP, CWE); PAM-specific pitfalls based on training data |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Bun PAM compatibility**: Test authenticate-pam or node-linux-pam with Bun runtime before committing to helper approach; if they work, architecture could simplify (but privilege separation still recommended)
- **macOS PAM differences**: Research focused on Linux; macOS PAM behaves differently and is secondary platform
- **Setuid helper IPC protocol**: Exact message format needs design during Phase 2 architecture
- **PTY with UID/GID**: Whether bun-pty can accept spawn options needs verification
- **Session persistence on restart**: Decision between "sessions lost" vs SQLite persistence affects user experience

## Sources

### Primary (HIGH confidence)
- Existing opencode codebase (server.ts, pty/index.ts, auth/index.ts, config.ts)
- Hono package.json and dist/types (v4.10.7 middleware capabilities)
- Standard Unix privilege separation patterns
- OWASP session management guidelines

### Secondary (MEDIUM confidence)
- Cockpit architecture (from training data — verify against cockpit-project.org docs)
- PAM API documentation (from training data — verify against Linux-PAM guides)
- Cookie security best practices (from training data — well-established, likely accurate)

### Tertiary (LOW confidence)
- authenticate-pam / node-linux-pam status (training data from ~2024; verify npm/GitHub for current state)
- Bun native module compatibility (rapidly evolving; test at implementation time)

---
*Research completed: 2026-01-19*
*Ready for roadmap: yes*
