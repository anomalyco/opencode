# Roadmap: Opencode System Authentication

## Overview

This roadmap delivers PAM-based system authentication for opencode's web interface, following the Cockpit model. Starting with configuration and session infrastructure, we build toward a privileged auth broker that enables multi-user access where commands execute under the authenticated user's identity. The journey proceeds from foundation (config, sessions) through core authentication (broker, PAM, process spawning), then UI and security hardening, and concludes with polish features (2FA, documentation).

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Configuration Foundation** - Auth configuration schema and backward compatibility
- [x] **Phase 2: Session Infrastructure** - Core session middleware, cookies, and expiration
- [x] **Phase 3: Auth Broker Core** - Privileged helper for PAM authentication and IPC
- [x] **Phase 4: Authentication Flow** - Login endpoint with PAM validation and session-user mapping
- [x] **Phase 5: User Process Execution** - Commands execute under authenticated user's UID
- [x] **Phase 6: Login UI** - Web login form with opencode styling
- [x] **Phase 7: Security Hardening** - CSRF, rate limiting, HTTPS detection
- [x] **Phase 8: Session Enhancements** - Remember me and session activity indicator
- [x] **Phase 9: Connection Security UI** - HTTPS/HTTP security badge in UI
- [x] **Phase 10: Two-Factor Authentication** - TOTP support via PAM integration
- [x] **Phase 11: Documentation** - Reverse proxy and PAM configuration guides
- [ ] **Phase 12: Server-Side TOTP Registration** - Offload .google_authenticator file generation to server
- [ ] **Phase 13: Passkeys Investigation** - Investigate adding passkeys and passkey management to opencode auth
- [ ] **Phase 14: Persistent Session Storage** - Add persistent session storage for multi-instance deployments
- [ ] **Phase 15: Update docs to use opencode fork (pRizz)** - Update docs to use the opencode fork at https://github.com/pRizz/opencode which actually has the auth implementation
- [ ] **Phase 16: Allow the user to download git repos so that they can work on them with their opencode sessions** - Allow the user to download git repos so that they can work on them with their opencode sessions
- [ ] **Phase 17: Make the client boundary the only place where "unknown" exists, then validate and normalize into strict types so the rest of the UI can't represent invalid shapes. Concrete pattern: Typed API layer: Expose functions like findFiles(): Promise<string[]> (no { data }, no unknown), and only allow those in UI code. Don't export the raw SDK client outside this layer. Runtime validation: Parse server responses with a schema (zod, valibot, io-ts). If validation fails, throw or return a typed error. This makes "wrong shape" impossible to flow into components. Normalization at the boundary: If the SDK can return { data } or raw arrays, normalize there and return the canonical type. No any/unknown past boundary: The rest of the app should only see string[] or a typed error union. This fully applies "illegal states unrepresentable": UI code can't accidentally access .map on a non-array because it never sees non-array values.** - Client boundary validation and normalization to prevent type mismatches
- [ ] **Phase 18: Audit all server routes for if they need authentication checks** - Audit all server routes for if they need authentication checks
- [ ] **Phase 19: Refactor auth login page** - Replace string-based login HTML with a proper SolidJS-based login page in `packages/opencode/src/server/routes/auth.ts`
- [ ] **Phase 20: Refactor 2FA verification page** - Refactor generate2FAPageHtml so the content is moved and integrated with the project at `packages/app` instead of the large string in code
- [ ] **Phase 21: Allow the user to add and manage SSH keys in the opencode webapp** - Allow the user to add and manage SSH keys in the opencode webapp; when attempting to clone via git SSH, prompt for a key if none are registered; add CRUD in settings; install keys in ~/.ssh; update ssh config; add server routes as needed
- [ ] **Phase 22: Refactor the /auth/2fa/setup page from auth.ts into the SolidJS app at packages/app** - Refactor the /auth/2fa/setup page from auth.ts into the SolidJS app at packages/app

## Phase Details

### Phase 1: Configuration Foundation

**Goal**: Auth configuration integrated into opencode.json with backward-compatible defaults
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-03, INFRA-04
**Success Criteria** (what must be TRUE):

1. User can add auth configuration block to opencode.json
2. opencode starts normally when auth config is absent (existing behavior unchanged)
3. opencode validates auth config and reports clear errors for invalid values
4. Auth is disabled by default when config section is missing
   **Plans**: 3 plans

Plans:

- [x] 01-01-PLAN.md — Auth schema definition (duration utility + AuthConfig Zod schema)
- [x] 01-02-PLAN.md — Config integration (add auth to Config.Info + error formatting)
- [x] 01-03-PLAN.md — Startup validation (PAM service file check + backward compatibility)

### Phase 2: Session Infrastructure

**Goal**: Users have secure session cookies with configurable expiration and logout capability
**Depends on**: Phase 1
**Requirements**: SESS-01, SESS-02, SESS-03
**Success Criteria** (what must be TRUE):

1. Session is stored as HttpOnly, Secure, SameSite=Strict cookie
2. User can log out and session is cleared both client-side and server-side
3. Session expires after configured idle timeout
4. Expired session redirects user to login
   **Plans**: 2 plans

Plans:

- [x] 02-01-PLAN.md — UserSession namespace with in-memory storage and CRUD operations
- [x] 02-02-PLAN.md — Auth middleware and routes (session validation, logout endpoints)

### Phase 3: Auth Broker Core

**Goal**: Privileged auth broker handles PAM authentication via Unix socket IPC
**Depends on**: Phase 1
**Requirements**: INFRA-01, INFRA-02
**Success Criteria** (what must be TRUE):

1. Auth broker daemon runs as privileged process (setuid or root)
2. Web server communicates with broker via Unix socket
3. Broker can authenticate credentials against PAM
4. Broker returns success/failure without exposing PAM internals to web process
   **Plans**: 6 plans

Plans:

- [x] 03-01-PLAN.md — Rust project foundation (Cargo.toml, IPC protocol types, config loading)
- [x] 03-02-PLAN.md — Authentication core (PAM wrapper, rate limiting, username validation)
- [x] 03-03-PLAN.md — IPC server (Unix socket server, request handler, daemon main)
- [x] 03-04-PLAN.md — Platform integration (systemd, launchd, PAM service files)
- [x] 03-05-PLAN.md — TypeScript client (broker client class for web server)
- [x] 03-06-PLAN.md — Setup command (CLI commands, build integration)

### Phase 4: Authentication Flow

**Goal**: Users can log in with UNIX credentials and receive a session mapped to their account
**Depends on**: Phase 2, Phase 3
**Requirements**: AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):

1. User can submit username/password via login endpoint
2. Credentials are validated against system PAM (LDAP/Kerberos transparent)
3. Successful login creates session mapped to UNIX UID/GID
4. Failed login returns generic error (no user enumeration)
5. Session contains user identity for subsequent requests
   **Plans**: 2 plans

Plans:

- [x] 04-01-PLAN.md — User info lookup and session schema extension (getUserInfo, UNIX fields in UserSession)
- [x] 04-02-PLAN.md — Login endpoint (POST /auth/login, GET /auth/status, broker integration)

### Phase 5: User Process Execution

**Goal**: Commands and file operations execute under the authenticated user's UNIX identity
**Depends on**: Phase 4
**Requirements**: AUTH-04
**Success Criteria** (what must be TRUE):

1. Shell commands spawn with authenticated user's UID/GID
2. File operations respect authenticated user's permissions
3. Process environment includes correct USER, HOME, SHELL
4. Unauthorized users cannot execute commands (auth required)
   **Plans**: 10 plans

Plans:

- [x] 05-01-PLAN.md — PTY allocation module (openpty, chown, session state)
- [x] 05-02-PLAN.md — User process spawning (impersonation, login environment)
- [x] 05-03-PLAN.md — IPC protocol extension (SpawnPty, KillPty, ResizePty methods)
- [x] 05-04-PLAN.md — PTY handler implementation (wire handlers to modules)
- [x] 05-05-PLAN.md — Session registration protocol (RegisterSession, UnregisterSession)
- [x] 05-06-PLAN.md — TypeScript BrokerClient extension (spawn/kill/resize/register)
- [x] 05-07-PLAN.md — Web server integration (login registers, PTY routes use broker)
- [x] 05-08-PLAN.md — Broker PTY I/O (PtyWrite, PtyRead, broker-pty.ts)
- [x] 05-09-PLAN.md — Auth enforcement on PTY routes (require session, pass sessionId)
- [x] 05-10-PLAN.md — Integration tests and verification (end-to-end testing)

### Phase 6: Login UI

**Goal**: Users have a polished login form matching opencode design
**Depends on**: Phase 4
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):

1. Login page displays username and password fields
2. Login page matches opencode visual design
3. Password field has show/hide toggle (eye icon)
4. Form shows clear error messages for failed login
   **Plans**: 1 plan

Plans:

- [x] 06-01-PLAN.md — Login page route with form, password toggle, styling, and error display

### Phase 7: Security Hardening

**Goal**: Login and state-changing operations are protected against common attacks
**Depends on**: Phase 4
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):

1. CSRF token required for login form and state-changing requests
2. Warning displayed when connecting over HTTP on public network
3. Failed login attempts are rate-limited by IP and username
4. Option exists to refuse login over insecure HTTP connections
   **Plans**: 3 plans

Plans:

- [x] 07-01-PLAN.md — CSRF protection infrastructure (token generation, middleware, login integration)
- [x] 07-02-PLAN.md — Login rate limiting (hono-rate-limiter, security event logging)
- [x] 07-03-PLAN.md — HTTP/HTTPS detection and warning (login page warning, require_https enforcement)

### Phase 8: Session Enhancements

**Goal**: Users have "remember me" option and can see session status
**Depends on**: Phase 2, Phase 6
**Requirements**: SESS-04, UI-03
**Success Criteria** (what must be TRUE):

1. "Remember me" checkbox extends session lifetime
2. Session activity indicator shows username with logout access
3. Session refreshes on user activity (prevents unexpected logout)
   **Plans**: 4 plans

Plans:

- [x] 08-01-PLAN.md — Remember me backend (persistent cookies, extended session timeout)
- [x] 08-02-PLAN.md — Session context and username indicator (SessionProvider, SessionIndicator)
- [x] 08-03-PLAN.md — Expiration warning and overlay (toast notification, session expired dialog)
- [x] 08-04-PLAN.md — Layout integration (SessionIndicator in header, polished dropdown)

### Phase 9: Connection Security UI

**Goal**: Users can see at a glance whether their connection is secure
**Depends on**: Phase 6, Phase 7
**Requirements**: UI-04
**Success Criteria** (what must be TRUE):

1. Lock icon displayed for HTTPS connections
2. Warning indicator displayed for HTTP connections
3. Security badge visible without user action
   **Plans**: 2 plans

Plans:

- [x] 09-01-PLAN.md — SecurityBadge component with icons, detection, tooltip, and popover details
- [x] 09-02-PLAN.md — HTTP warning banner and layout integration

### Phase 10: Two-Factor Authentication

**Goal**: Users can optionally enable TOTP-based 2FA for login
**Depends on**: Phase 4
**Requirements**: AUTH-05
**Success Criteria** (what must be TRUE):

1. 2FA prompt appears after password validation when enabled
2. TOTP codes validated via PAM (pam_google_authenticator or similar)
3. 2FA is optional per-user (configured via PAM, not opencode)
4. Login fails with clear message if 2FA required but not provided
   **Plans**: 8 plans

Plans:

- [x] 10-01-PLAN.md — 2FA config and broker OTP module (config schema, has_2fa_configured, validate_otp)
- [x] 10-02-PLAN.md — Broker protocol extension (Check2fa, AuthenticateOtp methods)
- [x] 10-03-PLAN.md — Token utilities (device trust JWT, 2FA token JWT)
- [x] 10-04-PLAN.md — BrokerClient 2FA methods (check2fa, authenticateOtp)
- [x] 10-05-PLAN.md — Auth routes 2FA flow (2fa_required response, /login/2fa endpoint)
- [x] 10-06-PLAN.md — 2FA verification page (countdown timer, auto-submit, remember device)
- [x] 10-07-PLAN.md — Setup wizard (QR code generation, verification)
- [x] 10-08-PLAN.md — Device trust UI (revoke device, setup link in dropdown)

### Phase 11: Documentation

**Goal**: Users have clear guides for deployment with auth enabled
**Depends on**: Phase 7, Phase 10
**Requirements**: DOC-01, DOC-02
**Success Criteria** (what must be TRUE):

1. Reverse proxy guide covers nginx and Caddy with TLS examples
2. PAM service file documentation explains configuration
3. Troubleshooting section covers common PAM issues
4. Documentation is accessible from project README or docs site
   **Plans**: 4 plans

Plans:

- [x] 11-01-PLAN.md — Docs structure and reverse proxy guide (nginx, Caddy, TLS, WebSocket)
- [x] 11-02-PLAN.md — PAM configuration guide (setup, LDAP, 2FA, broker)
- [x] 11-03-PLAN.md — Troubleshooting guide (flowcharts, debugging, common errors)
- [x] 11-04-PLAN.md — Index finalization and README integration

### Phase 12: Server-Side TOTP Registration

**Goal**: Simplify TOTP setup by having the server create ~/.google_authenticator instead of requiring users to run shell commands
**Depends on**: Phase 10
**Requirements**: None (UX improvement)
**Success Criteria** (what must be TRUE):

1. Server generates and writes ~/.google_authenticator file for the authenticated user
2. User only needs to scan QR code and verify - no shell command required
3. Auth broker handles file creation with correct ownership (user's UID/GID)
4. Existing manual setup path remains available as fallback
   **Plans**: 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 12 to break down)

**Details:**
[To be added during planning]

### Phase 13: Passkeys Investigation

**Goal**: Investigate adding passkeys and passkey management to opencode auth
**Depends on**: Phase 10
**Requirements**: None (investigation/research)
**Success Criteria** (what must be TRUE):

1. Research complete on WebAuthn/passkey integration with PAM-based auth
2. Architecture decision documented for passkey storage and management
3. Feasibility assessment for browser-side and server-side requirements
4. Clear recommendation on implementation approach
   **Plans**: 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 13 to break down)

**Details:**
[To be added during planning]

### Phase 14: Persistent Session Storage

**Goal**: Enable session persistence across server restarts and multi-instance deployments
**Depends on**: Phase 2
**Requirements**: None (infrastructure improvement)
**Success Criteria** (what must be TRUE):

1. Sessions survive server restarts
2. Multiple server instances share session state
3. Session storage backend is configurable (file, Redis, database)
4. Existing in-memory mode remains available for single-instance deployments
   **Plans**: 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 14 to break down)

**Details:**
[To be added during planning]

### Phase 15: Update docs to use opencode fork (pRizz)

**Goal**: [To be planned]
**Depends on**: Phase 14
**Plans**: 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 15 to break down)

**Details:**
Update docs to use the opencode fork at https://github.com/pRizz/opencode which actually has the auth implementation. [To be added during planning.]

### Phase 16: Allow the user to download git repos so that they can work on them with their opencode sessions

**Goal:** Incorporate the Ralphcity UI clone workflow into the opencode front end to support repo download/clone flows
**Depends on:** Phase 15
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 16 to break down)

**Details:**
This phase should merge or adapt the Ralphcity UI clone experience and integrate it into the opencode web UI.
[To be added during planning]

### Phase 17: Make the client boundary the only place where "unknown" exists, then validate and normalize into strict types so the rest of the UI can't represent invalid shapes. Concrete pattern: Typed API layer: Expose functions like findFiles(): Promise<string[]> (no { data }, no unknown), and only allow those in UI code. Don't export the raw SDK client outside this layer. Runtime validation: Parse server responses with a schema (zod, valibot, io-ts). If validation fails, throw or return a typed error. This makes "wrong shape" impossible to flow into components. Normalization at the boundary: If the SDK can return { data } or raw arrays, normalize there and return the canonical type. No any/unknown past boundary: The rest of the app should only see string[] or a typed error union. This fully applies "illegal states unrepresentable": UI code can't accidentally access .map on a non-array because it never sees non-array values.

**Goal:** [To be planned]
**Depends on:** Phase 16
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 17 to break down)

**Details:**
[To be added during planning]

### Phase 18: Audit all server routes for if they need authentication checks

**Goal:** [To be planned]
**Depends on:** Phase 17
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 18 to break down)

**Details:**
[To be added during planning]

### Phase 19: Refactor auth login page

**Goal:** The auth login page is delivered as a SolidJS entry with visual and behavioral parity to the current login UI.
**Depends on:** Phase 18
**Plans:** 2 plans

Plans:

- [x] 19-01-PLAN.md — SolidJS login entry and Vite multi-page build
- [x] 19-02-PLAN.md — Auth route serves Solid login HTML with security context

**Details:**
[To be added during planning]

### Phase 20: Refactor 2FA verification page

**Goal:** The 2FA verification page is delivered as a SolidJS entry with visual and behavioral parity to the current inline 2FA UI.
**Depends on:** Phase 19
**Plans:** 2 plans

Plans:

- [ ] 20-01-PLAN.md — SolidJS 2FA entry and Vite multi-page build
- [ ] 20-02-PLAN.md — Auth route serves Solid 2FA HTML with bootstrap data

**Details:**
Move `generate2FAPageHtml` into `packages/app` and serve `2fa.html` from the UI build, following the login page refactor pattern.

### Phase 21: Allow the user to add and manage SSH keys in the opencode webapp

**Goal:** Users can manage SSH keys in the webapp, install them into ~/.ssh with updated config entries, and are prompted to add a key when cloning via SSH without one.
**Depends on:** Phase 20
**Plans:** 2 plans

Plans:

- [ ] 21-01-PLAN.md — Server-side SSH key storage, install, and CRUD routes
- [ ] 21-02-PLAN.md — SDK regeneration, settings UI, and clone prompt for missing keys

**Details:**
Allow the user to add and manage SSH keys in the opencode webapp; when attempting to clone via git SSH, prompt for a key if none are registered; add CRUD in settings; install keys in ~/.ssh; update ssh config; add server routes as needed.

### Phase 22: Refactor the /auth/2fa/setup page from auth.ts into the SolidJS app at packages/app

**Goal:** [To be planned]
**Depends on:** Phase 21
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd:plan-phase 22 to break down)

**Details:**
[To be added during planning]

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15

| Phase                                        | Plans Complete | Status      | Completed  |
| -------------------------------------------- | -------------- | ----------- | ---------- |
| 1. Configuration Foundation                  | 3/3            | Complete    | 2026-01-20 |
| 2. Session Infrastructure                    | 2/2            | Complete    | 2026-01-20 |
| 3. Auth Broker Core                          | 6/6            | Complete    | 2026-01-20 |
| 4. Authentication Flow                       | 2/2            | Complete    | 2026-01-20 |
| 5. User Process Execution                    | 10/10          | Complete    | 2026-01-22 |
| 6. Login UI                                  | 1/1            | Complete    | 2026-01-22 |
| 7. Security Hardening                        | 3/3            | Complete    | 2026-01-22 |
| 8. Session Enhancements                      | 4/4            | Complete    | 2026-01-23 |
| 9. Connection Security UI                    | 2/2            | Complete    | 2026-01-24 |
| 10. Two-Factor Authentication                | 8/8            | Complete    | 2026-01-24 |
| 11. Documentation                            | 4/4            | Complete    | 2026-01-25 |
| 12. Server-Side TOTP Registration            | 0/TBD          | Not started | -          |
| 13. Passkeys Investigation                   | 0/TBD          | Not started | -          |
| 14. Persistent Session Storage               | 0/TBD          | Not started | -          |
| 15. Update docs to use opencode fork (pRizz) | 0/TBD          | Not started | -          |
