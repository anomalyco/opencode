# Requirements: Opencode System Authentication

**Defined:** 2026-01-19
**Core Value:** Secure remote access to your opencode instance from anywhere — authenticate once with your system credentials, work on your projects from any device.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Authentication

- [ ] **AUTH-01**: User can log in with username and password via web form
- [ ] **AUTH-02**: Credentials validated against system PAM (supports LDAP/Kerberos transparently)
- [ ] **AUTH-03**: Authenticated session maps to real UNIX user (UID/GID)
- [ ] **AUTH-04**: Commands and file operations execute under authenticated user's identity
- [ ] **AUTH-05**: User can optionally enable 2FA via TOTP (PAM module integration)

### Sessions

- [ ] **SESS-01**: Session stored as secure cookie (HttpOnly, Secure, SameSite=Strict)
- [ ] **SESS-02**: User can log out, clearing session cookie and server-side state
- [ ] **SESS-03**: Session expires after configurable idle timeout
- [ ] **SESS-04**: "Remember me" option extends session lifetime for trusted devices

### Security

- [ ] **SEC-01**: CSRF protection on login form and state-changing operations
- [ ] **SEC-02**: Warning displayed when connecting over HTTP on public network
- [ ] **SEC-03**: Rate limiting on failed login attempts (IP and username-based)
- [ ] **SEC-04**: Option to refuse login over insecure HTTP connections

### Infrastructure

- [ ] **INFRA-01**: Auth broker (setuid helper) handles PAM authentication and user process spawning
- [ ] **INFRA-02**: Unix socket IPC between unprivileged web server and privileged auth broker
- [ ] **INFRA-03**: Auth configuration via opencode.json (enabled, sessionTimeout, rememberMe, etc.)
- [ ] **INFRA-04**: Auth disabled by default; existing single-user behavior unchanged

### User Interface

- [ ] **UI-01**: Login page with username/password form matching opencode design
- [ ] **UI-02**: Password visibility toggle (eye icon to show/hide)
- [ ] **UI-03**: Session activity indicator showing time remaining before expiry
- [ ] **UI-04**: Connection security badge (lock icon for HTTPS, warning for HTTP)

### Documentation

- [ ] **DOC-01**: Reverse proxy setup guide (nginx, Caddy) with TLS configuration examples
- [ ] **DOC-02**: PAM service file configuration and troubleshooting documentation

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Authentication

- **AUTH-V2-01**: User can authenticate via SSH key (passwordless)
- **AUTH-V2-02**: User can view and revoke other active sessions (multi-session awareness)

### Privilege Escalation

- **PRIV-01**: User can elevate privileges for admin actions (sudo prompts in UI)
- **PRIV-02**: Polkit integration for fine-grained action authorization

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom user database | Duplicates OS user management; PAM delegates to passwd/LDAP/Kerberos |
| Built-in TLS termination | Complex, error-prone; better handled by nginx/Caddy reverse proxy |
| OAuth/SSO for self-hosted | PAM already supports enterprise SSO via LDAP/Kerberos integration |
| Account registration | Self-hosted instances use existing system accounts; admins manage via OS tools |
| Password reset via email | No email infrastructure assumed; users reset via admin/sudo |
| Fine-grained app permissions | Use existing UNIX permission model and sudo/polkit |
| Anonymous/guest access | Defeats purpose of system authentication |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 4 | Pending |
| AUTH-02 | Phase 4 | Pending |
| AUTH-03 | Phase 4 | Pending |
| AUTH-04 | Phase 5 | Pending |
| AUTH-05 | Phase 10 | Pending |
| SESS-01 | Phase 2 | Complete |
| SESS-02 | Phase 2 | Complete |
| SESS-03 | Phase 2 | Complete |
| SESS-04 | Phase 8 | Pending |
| SEC-01 | Phase 7 | Pending |
| SEC-02 | Phase 7 | Pending |
| SEC-03 | Phase 7 | Pending |
| SEC-04 | Phase 7 | Pending |
| INFRA-01 | Phase 3 | Pending |
| INFRA-02 | Phase 3 | Pending |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| UI-01 | Phase 6 | Pending |
| UI-02 | Phase 6 | Pending |
| UI-03 | Phase 8 | Pending |
| UI-04 | Phase 9 | Pending |
| DOC-01 | Phase 11 | Pending |
| DOC-02 | Phase 11 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-01-19*
*Last updated: 2026-01-19 after roadmap creation*
