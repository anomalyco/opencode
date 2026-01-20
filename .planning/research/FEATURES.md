# Feature Landscape

**Domain:** System-authenticated web application (Cockpit-style PAM auth)
**Researched:** 2026-01-19
**Confidence:** MEDIUM (based on Cockpit patterns and PAM auth best practices from training data; WebSearch unavailable for verification)

## Table Stakes

Features users expect from any system-authenticated web application. Missing any of these makes the product feel incomplete or insecure.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Username/password login form | Basic authentication interface | Low | Standard form with UNIX credential fields |
| PAM authentication backend | Core auth mechanism for UNIX credentials | Medium | Uses system PAM stack; supports LDAP/Kerberos transparently |
| Secure session cookies | Maintain auth state across requests | Low | HttpOnly, Secure flags; configurable expiry |
| Logout functionality | End session and clear credentials | Low | Clear session cookie, invalidate server-side state |
| Session timeout | Auto-expire inactive sessions | Low | Configurable idle timeout (e.g., 15 min default) |
| HTTPS requirement warning | Alert users of insecure connections | Low | Detect HTTP over non-localhost; show warning before login |
| Failed login feedback | Clear error on bad credentials | Low | Generic "invalid credentials" (avoid username enumeration) |
| CSRF protection | Prevent cross-site request forgery | Low | Token-based CSRF for login form and session actions |
| Brute-force protection | Rate limit failed login attempts | Medium | PAM handles via pam_faillock/pam_tally2; may need app-layer backup |
| Session-to-UID mapping | Commands run as authenticated user | High | Server process privilege escalation or setuid helper |

## Differentiators

Features that set the product apart. Not strictly required, but provide meaningful value for self-hosted remote access.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| "Remember me" / persistent sessions | Convenience for trusted devices | Low | Extended session expiry (e.g., 30 days); stored token with refresh |
| Insecure connection blocking | Prevent credential exposure | Low | Option to refuse login over HTTP on public networks |
| Multi-session awareness | See other active sessions | Medium | List active sessions with IP/device info; revoke others |
| Session activity indicator | Know when session is about to expire | Low | UI indicator showing time remaining; refresh on activity |
| Automatic session refresh | Keep working sessions alive | Low | Background keepalive while tab is active |
| Connection security badge | Visual trust indicator | Low | Lock icon + "Secure" vs warning for HTTP |
| Login page customization | Branding for enterprise deployments | Low | Configurable logo/message on login page via config |
| Keyboard navigation | Accessibility for power users | Low | Tab order, Enter to submit, focus management |
| Password visibility toggle | UX improvement for complex passwords | Low | Eye icon to reveal password field |
| 2FA support (TOTP) | Additional security layer | Medium | Optional; PAM can delegate to pam_google_authenticator or pam_oath |
| SSH key authentication | Passwordless auth option | High | More complex; useful for automation/scripts |
| Privilege escalation UI (sudo) | Elevate permissions for admin tasks | High | Cockpit does this; prompt for password to run as root |
| Locale/timezone handling | Commands run in user's environment | Low | Inherit user's LANG, TZ from system |

## Anti-Features

Features to explicitly NOT build. Common mistakes or scope creep traps.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Custom user database | Duplicates OS user management; maintenance burden | Delegate entirely to PAM/passwd |
| Built-in TLS termination | Complex, error-prone; better tools exist | Document reverse proxy setup (nginx, Caddy) |
| OAuth/SSO for self-hosted | PAM already supports enterprise SSO via LDAP/Kerberos; complexity without benefit | Use PAM's SSO capabilities |
| Account registration | Self-hosted = system accounts already exist | Admins create system users via normal OS tools |
| Password reset via email | No email infrastructure assumption; security risk | Users reset via sudo/admin or OS tools |
| Fine-grained app permissions | Duplicates sudo/polkit; consistency issues | Use existing UNIX permission model |
| Session sharing between users | Security boundary violation | Sessions are per-user; admin can view via audit log |
| Anonymous/guest access | Defeats purpose of system auth | Require authentication for all access |
| Client-side session storage | XSS vulnerability; tokens visible to JS | Use HttpOnly cookies only |
| Remember password in browser | Not application's job; browser handles this | Let browser's password manager work |
| Automatic login | Security risk; circumvents auth | Require explicit "remember me" action |

## Feature Dependencies

```
Login Form
    |
    v
PAM Authentication <---> Brute-force Protection
    |
    v
Session Creation --> Session Cookie
    |                    |
    v                    v
Session-to-UID Mapping  Session Timeout
    |                    |
    v                    v
Command Execution    Auto-Refresh / Remember Me
    |
    v
Logout --> Session Invalidation
```

**Critical path:**
1. PAM authentication must work before any session features
2. Session-to-UID mapping required before commands can execute
3. HTTPS detection should gate login (at least warn)

**Independent features:**
- Remember me (extension of session management)
- Multi-session awareness (enhancement, not blocking)
- 2FA (optional security layer)

## Phase Recommendations

### Phase 1: MVP Authentication (Table Stakes)

Build the minimum viable authenticated system:

1. **Login Form UI** - Username/password form with basic styling
2. **PAM Backend** - Authenticate credentials via PAM
3. **Session Cookies** - Create/validate session, HttpOnly + Secure
4. **Logout** - Clear session
5. **HTTPS Warning** - Detect insecure, show warning (don't block yet)
6. **CSRF Protection** - Token for login form

**Why this order:** Can't test sessions without login, can't test logout without sessions.

### Phase 2: Security Hardening

1. **Session Timeout** - Configurable idle expiry
2. **Brute-force Protection** - App-layer rate limiting (supplement PAM)
3. **Insecure Connection Blocking** - Option to refuse HTTP login
4. **Session-to-UID Mapping** - Commands execute under correct user

**Why this order:** Timeout is simpler; UID mapping is highest complexity but core value.

### Phase 3: UX Polish

1. **Remember Me** - Persistent sessions for trusted devices
2. **Session Activity Indicator** - Time remaining UI
3. **Automatic Session Refresh** - Keepalive while active
4. **Password Visibility Toggle** - Eye icon
5. **Keyboard Navigation** - Accessibility

### Phase 4: Advanced (Optional)

1. **Multi-Session Awareness** - List/revoke sessions
2. **2FA Support** - TOTP via PAM module
3. **Privilege Escalation UI** - sudo prompts for admin actions

## Complexity Assessment

| Complexity | Features |
|------------|----------|
| **Low** | Login form, logout, session cookies, CSRF, HTTPS warning, session timeout, remember me, UI indicators, password toggle |
| **Medium** | PAM integration, brute-force protection, multi-session tracking, 2FA |
| **High** | Session-to-UID mapping (requires privilege escalation design), SSH key auth, sudo UI |

## Cockpit Reference Points

Based on Cockpit's authentication model (from training data):

1. **Direct PAM** - Cockpit authenticates directly via PAM, not a custom layer
2. **Session = UNIX User** - 1:1 mapping, no invented permissions
3. **Privilege via Polkit** - Admin actions prompt for sudo password
4. **TLS via External** - Cockpit expects reverse proxy for production
5. **HTTP Warning** - Shows "Not Secure" but allows login locally
6. **Session Timeout** - Configurable, default 15 minutes
7. **No User Management** - Doesn't create users; delegates to OS

## Risk Areas

| Risk | Mitigation |
|------|------------|
| PAM integration complexity varies by OS | Focus on Linux; macOS as secondary |
| Session-to-UID requires elevated privileges | Design setuid helper or run as root |
| HTTP detection has edge cases (proxies, localhost) | Trust X-Forwarded-Proto from trusted proxies only |
| Brute-force handling differs across PAM modules | Add app-layer rate limiting as backup |

## Sources

- **Cockpit architecture knowledge:** From training data (MEDIUM confidence)
- **PAM authentication patterns:** From training data (HIGH confidence on general patterns)
- **Web session security best practices:** From training data (HIGH confidence on general patterns)

**Note:** WebSearch and WebFetch unavailable during research. Recommendations based on established patterns for system-authenticated web applications. Verify current Cockpit documentation before implementation.
