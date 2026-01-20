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
- [ ] **Phase 4: Authentication Flow** - Login endpoint with PAM validation and session-user mapping
- [ ] **Phase 5: User Process Execution** - Commands execute under authenticated user's UID
- [ ] **Phase 6: Login UI** - Web login form with opencode styling
- [ ] **Phase 7: Security Hardening** - CSRF, rate limiting, HTTPS detection
- [ ] **Phase 8: Session Enhancements** - Remember me and session activity indicator
- [ ] **Phase 9: Connection Security UI** - HTTPS/HTTP security badge in UI
- [ ] **Phase 10: Two-Factor Authentication** - TOTP support via PAM integration
- [ ] **Phase 11: Documentation** - Reverse proxy and PAM configuration guides

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
**Plans**: TBD

Plans:
- [ ] 04-01: TBD

### Phase 5: User Process Execution
**Goal**: Commands and file operations execute under the authenticated user's UNIX identity
**Depends on**: Phase 4
**Requirements**: AUTH-04
**Success Criteria** (what must be TRUE):
  1. Shell commands spawn with authenticated user's UID/GID
  2. File operations respect authenticated user's permissions
  3. Process environment includes correct USER, HOME, SHELL
  4. Unauthorized users cannot execute commands (auth required)
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 6: Login UI
**Goal**: Users have a polished login form matching opencode design
**Depends on**: Phase 4
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. Login page displays username and password fields
  2. Login page matches opencode visual design
  3. Password field has show/hide toggle (eye icon)
  4. Form shows clear error messages for failed login
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: Security Hardening
**Goal**: Login and state-changing operations are protected against common attacks
**Depends on**: Phase 4
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. CSRF token required for login form and state-changing requests
  2. Warning displayed when connecting over HTTP on public network
  3. Failed login attempts are rate-limited by IP and username
  4. Option exists to refuse login over insecure HTTP connections
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: Session Enhancements
**Goal**: Users have "remember me" option and can see session status
**Depends on**: Phase 2, Phase 6
**Requirements**: SESS-04, UI-03
**Success Criteria** (what must be TRUE):
  1. "Remember me" checkbox extends session lifetime
  2. Session activity indicator shows time remaining
  3. Session refreshes on user activity (prevents unexpected logout)
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

### Phase 9: Connection Security UI
**Goal**: Users can see at a glance whether their connection is secure
**Depends on**: Phase 6, Phase 7
**Requirements**: UI-04
**Success Criteria** (what must be TRUE):
  1. Lock icon displayed for HTTPS connections
  2. Warning indicator displayed for HTTP connections
  3. Security badge visible without user action
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

### Phase 10: Two-Factor Authentication
**Goal**: Users can optionally enable TOTP-based 2FA for login
**Depends on**: Phase 4
**Requirements**: AUTH-05
**Success Criteria** (what must be TRUE):
  1. 2FA prompt appears after password validation when enabled
  2. TOTP codes validated via PAM (pam_google_authenticator or similar)
  3. 2FA is optional per-user (configured via PAM, not opencode)
  4. Login fails with clear message if 2FA required but not provided
**Plans**: TBD

Plans:
- [ ] 10-01: TBD

### Phase 11: Documentation
**Goal**: Users have clear guides for deployment with auth enabled
**Depends on**: Phase 7, Phase 10
**Requirements**: DOC-01, DOC-02
**Success Criteria** (what must be TRUE):
  1. Reverse proxy guide covers nginx and Caddy with TLS examples
  2. PAM service file documentation explains configuration
  3. Troubleshooting section covers common PAM issues
  4. Documentation is accessible from project README or docs site
**Plans**: TBD

Plans:
- [ ] 11-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Configuration Foundation | 3/3 | Complete | 2026-01-20 |
| 2. Session Infrastructure | 2/2 | Complete | 2026-01-20 |
| 3. Auth Broker Core | 6/6 | Complete | 2026-01-20 |
| 4. Authentication Flow | 0/TBD | Not started | - |
| 5. User Process Execution | 0/TBD | Not started | - |
| 6. Login UI | 0/TBD | Not started | - |
| 7. Security Hardening | 0/TBD | Not started | - |
| 8. Session Enhancements | 0/TBD | Not started | - |
| 9. Connection Security UI | 0/TBD | Not started | - |
| 10. Two-Factor Authentication | 0/TBD | Not started | - |
| 11. Documentation | 0/TBD | Not started | - |
