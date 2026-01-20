# System Authentication for Opencode Web

## What This Is

System authentication for the opencode web application, following the Cockpit model. Users authenticate with their UNIX credentials (PAM), sessions map to their real system account, and all commands execute under their UID. This enables secure remote access to self-hosted opencode instances from anywhere.

## Core Value

**Secure remote access to your opencode instance from anywhere** — authenticate once with your system credentials, work on your projects from any device, with all actions running as you.

## Requirements

### Validated

<!-- Existing capabilities the codebase already provides -->

- ✓ Web app served via `opencode web` command — existing
- ✓ Server layer with HTTP/SSE API — existing
- ✓ Layered config system (remote → global → project) — existing
- ✓ Session management and persistence — existing
- ✓ Tool execution (bash, file ops) under current user — existing

### Active

<!-- New capabilities to build -->

- [ ] PAM authentication for web app login
- [ ] Session cookie with configurable timeout
- [ ] "Remember me" option for persistent sessions
- [ ] Auth configuration in opencode.json
- [ ] Insecure connection detection (HTTP over public internet)
- [ ] Warning/block for insecure login attempts
- [ ] Login UI for web app
- [ ] Session-to-UNIX-user mapping
- [ ] Commands execute under authenticated user's UID
- [ ] Multi-user support (different users get their own sessions)
- [ ] Documentation for reverse proxy setup (nginx, Caddy)
- [ ] Updated wizards/onboarding for auth setup

### Out of Scope

- TLS termination — handled by reverse proxy, not opencode
- OAuth/SSO for self-hosted — may revisit in future, PAM covers most enterprise SSO via LDAP/Kerberos
- Custom user database — delegate entirely to OS
- Fine-grained app permissions — use existing sudo/polkit model
- Mobile app authentication — web-first

## Context

**Deployment scenario:** User runs opencode on a personal remote server (VPS, home server). They want to access it securely from anywhere — coffee shop, phone browser, different machines. Currently the web UI has no authentication gate.

**Cockpit as reference:** Cockpit's auth model is the gold standard here. No shadow users, no invented permissions. PAM says yes/no, session maps to UNIX user, commands run as that user. Privilege escalation via existing sudo/polkit rules.

**Existing auth systems:**
- Console (hosted) uses OAuth (GitHub/Google) via OpenAuth — separate system
- CLI stores provider API keys in `~/.opencode/data/auth.json` — different concern
- This new system auth is specifically for self-hosted web instances

**Server architecture:** The server currently runs as whoever launched it. To run commands as different authenticated users, the server process needs elevated privileges (run as root or use setuid helper) to spawn processes under the correct UID.

## Constraints

- **Platform:** Linux primary (PAM). macOS has PAM support but less common for server deployments.
- **Config integration:** Must use existing `opencode.json` config pattern, not separate config files.
- **Reverse proxy required:** TLS must be handled externally. Documentation and detection, not implementation.
- **Backward compatible:** Auth disabled by default. Existing single-user local usage unchanged.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Delegate to PAM, not custom auth | Cockpit model — no shadow users, works with existing enterprise auth (LDAP, Kerberos) | — Pending |
| TLS via reverse proxy | Don't reinvent cert management; nginx/Caddy handle this well | — Pending |
| Config in opencode.json | Fits existing config pattern, easy for users to understand | — Pending |
| Auth disabled by default | Don't break existing local usage; opt-in for remote access | — Pending |

---
*Last updated: 2026-01-19 after initialization*
