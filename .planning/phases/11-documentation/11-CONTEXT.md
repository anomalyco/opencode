# Phase 11: Documentation - Context

**Gathered:** 2026-01-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Deployment documentation for auth-enabled opencode — reverse proxy setup, PAM configuration, and troubleshooting guides. Users have clear guides for deployment with authentication enabled.

</domain>

<decisions>
## Implementation Decisions

### Doc Structure & Location
- Docs live in `docs/` folder in repo, linked from README
- Multiple files by topic: reverse-proxy.md, pam.md, troubleshooting.md, etc.
- Both README links to docs/README.md which has full index
- Lowercase with hyphens naming convention (reverse-proxy.md, pam-config.md)

### Reverse Proxy Coverage
- Cover nginx + Caddy as primary proxies
- Cloud providers: AWS (ALB/NLB), GCP, Azure, Cloudflare, Digital Ocean, Hetzner (if they offer managed TLS/certs)
- Both snippets inline and full working configs (in separate files or appendix)
- WebSocket proxy configuration gets dedicated section
- HTTP-only (non-TLS) setup for local development gets separate section
- trustProxy config option explained: when to use, X-Forwarded-* headers
- Security headers section (HSTS, CSP, etc.) for production
- Rate limiting at proxy level documented as defense in depth
- Chained proxies documented (e.g., Cloudflare + nginx)
- systemd unit file example included
- Reference opencode-cloud (https://github.com/pRizz/opencode-cloud) by Peter Ryszkiewicz for service management with basic usage and examples
- Let's Encrypt/ACME setup for nginx (certbot) and Caddy (built-in)
- Container/Docker deployment is separate doc (out of scope for this phase)

### PAM Documentation Depth
- Both paths: quick start for those who know PAM, detailed for newcomers
- LDAP/Active Directory integration gets dedicated section
- 2FA PAM setup (pam_google_authenticator) step-by-step guide
- opencode-broker setup detailed: setuid/setgid, socket permissions, systemd unit
- macOS-specific PAM configuration documented (OpenDirectory)
- Troubleshooting: both flowchart/decision tree AND detailed text FAQ
- Debug logging instructions: how to enable PAM debug, read auth logs

### Audience & Tone
- Both audiences: sysadmins deploying for teams AND developers self-hosting
- Professional and technical tone
- Include 'why' explanations alongside 'how' (explain reasoning behind security choices)
- Commands: both clean copy-paste ready (with placeholders) AND annotated versions below

### Claude's Discretion
- SELinux/AppArmor coverage depth (based on frequency of issues)
- Exact flowchart format/tool
- Order of sections within each doc

</decisions>

<specifics>
## Specific Ideas

- Reference opencode-cloud project for service management: https://github.com/pRizz/opencode-cloud
- Use `<YOUR_DOMAIN>` style placeholders for copy-paste commands
- Security headers section should cover OWASP recommendations

</specifics>

<deferred>
## Deferred Ideas

- Container/Docker deployment guide — separate phase or doc
- Kubernetes deployment — future phase

</deferred>

---

*Phase: 11-documentation*
*Context gathered: 2026-01-25*
