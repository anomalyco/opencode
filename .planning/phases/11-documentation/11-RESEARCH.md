# Phase 11: Documentation - Research

**Researched:** 2026-01-25
**Domain:** Technical deployment documentation (reverse proxy, PAM authentication, troubleshooting)
**Confidence:** HIGH

## Summary

Deployment documentation for auth-enabled opencode requires coverage of three primary domains: reverse proxy configuration (nginx/Caddy + cloud providers), PAM authentication setup (including 2FA and LDAP), and comprehensive troubleshooting guides. The research identified established patterns for technical documentation structure, authoritative security header configurations from OWASP, and verified reverse proxy configurations for WebSocket-heavy applications like opencode.

The standard approach for documentation organization is a `docs/` folder with topic-based markdown files (reverse-proxy.md, pam.md, troubleshooting.md), linked from the main README. This follows GitHub's recommended documentation hierarchy and aligns with how opencode.ai currently structures their documentation. For diagrams and flowcharts, Mermaid provides native GitHub support and integrates seamlessly with markdown documentation workflows.

Critical findings include: nginx requires explicit WebSocket header configuration while Caddy handles WebSockets automatically; PAM troubleshooting requires debug logging via syslog facilities; and security headers (especially HSTS, CSP, X-Content-Type-Options) are mandatory for production deployments. The opencode-cloud project by Peter Ryszkiewicz provides systemd integration examples that should be referenced.

**Primary recommendation:** Structure documentation as separate markdown files in `docs/` folder, use Mermaid for flowcharts, prioritize copy-paste ready examples with annotated explanations below, and verify all configurations against official sources (nginx.org, caddyserver.com, OWASP cheat sheets).

## Standard Stack

The established tools/technologies for deployment documentation:

### Core
| Technology | Version/Source | Purpose | Why Standard |
|------------|----------------|---------|--------------|
| Markdown | GitHub Flavored | Documentation format | Universal support, versioning, inline code examples |
| Mermaid | 2025-2026 | Flowcharts/diagrams | Native GitHub rendering, text-based, version controllable |
| nginx | 1.x (current stable) | Reverse proxy | Industry standard for Node.js apps, proven WebSocket support |
| Caddy | 2.x | Reverse proxy | Automatic HTTPS via ACME, zero-config WebSocket support |
| Let's Encrypt | ACME protocol | TLS certificates | Free, automated, 90-day renewal supported by major tools |
| systemd | Platform default | Service management | Linux standard for process supervision and auto-start |

### Supporting
| Tool/Library | Version | Purpose | When to Use |
|-------------|---------|---------|-------------|
| certbot | Latest | Let's Encrypt client for nginx | nginx deployments needing automated cert management |
| pam_google_authenticator | libpam package | 2FA via TOTP | Enhanced security for PAM authentication |
| rsyslog/syslog | Platform default | PAM debug logging | Troubleshooting authentication failures |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mermaid | PlantUML, Graphviz | Mermaid has native GitHub support, simpler syntax |
| nginx | Apache, HAProxy | nginx/Caddy are dominant for Node.js WebSocket apps |
| Let's Encrypt | Commercial CA | LE is free, automated, trusted by all browsers |

**Installation:** N/A (documentation phase, no runtime dependencies)

## Architecture Patterns

### Recommended Documentation Structure
```
docs/
├── README.md              # Index with links to all docs
├── reverse-proxy.md       # nginx, Caddy, cloud providers
├── reverse-proxy/         # Full config examples
│   ├── nginx-full.conf
│   └── Caddyfile-full
├── pam-config.md          # PAM setup, LDAP, 2FA
├── troubleshooting.md     # Decision trees, common errors
└── security-headers.md    # OWASP recommendations
```

Repository structure:
```
/
├── README.md              # Links to docs/README.md
├── docs/                  # All deployment documentation
└── .planning/             # Planning artifacts (may be gitignored)
```

### Pattern 1: Dual-Format Code Examples

**What:** Provide both clean copy-paste ready code and annotated versions
**When to use:** All configuration examples (reverse proxy, PAM, systemd)
**Example:**
```markdown
## Quick Copy (nginx WebSocket proxy)

\`\`\`nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
\`\`\`

## Annotated Version

\`\`\`nginx
# WebSocket requires HTTP/1.1 (not 1.0)
proxy_http_version 1.1;

# Pass upgrade headers (hop-by-hop, not passed by default)
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
# Why: WebSocket uses HTTP upgrade mechanism per RFC 6455
\`\`\`
```
**Source:** [nginx.org WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)

### Pattern 2: Progressive Disclosure for Technical Depth

**What:** Provide quick start for experts, detailed explanations for newcomers
**When to use:** PAM configuration, complex setups (LDAP, 2FA)
**Example:**
```markdown
## Quick Start (PAM experts)

Add to `/etc/pam.d/opencode`:
\`\`\`
auth required pam_unix.so
\`\`\`

## Detailed Setup (PAM newcomers)

### What is PAM?
[Explanation of PAM stack, module types, control flags]

### Step-by-step configuration
[Detailed walkthrough with why/what for each line]
```

### Pattern 3: Flowchart Decision Trees for Troubleshooting

**What:** Use Mermaid flowcharts for diagnostic workflows
**When to use:** Troubleshooting sections, decision points
**Example:**
```markdown
\`\`\`mermaid
flowchart TD
    A[Login fails] --> B{Check auth.log}
    B -->|PAM: auth failure| C[Enable PAM debug]
    B -->|Connection refused| D[Check opencode-broker status]
    C --> E{Debug shows?}
    E -->|No such user| F[Check user exists: id username]
    E -->|Permission denied| G[Check broker socket permissions]
\`\`\`
```
**Source:** [Mermaid flowchart syntax](https://mermaid.js.org/)

### Pattern 4: Placeholder Convention

**What:** Use consistent placeholder format for user-supplied values
**When to use:** All copy-paste examples with variables
**Convention:**
```bash
# Use angle brackets with ALL_CAPS for placeholders
server_name <YOUR_DOMAIN>;
ssl_certificate /etc/letsencrypt/live/<YOUR_DOMAIN>/fullchain.pem;
proxy_pass http://localhost:<OPENCODE_PORT>;
```

### Anti-Patterns to Avoid

- **Mixing quick start with detailed explanation:** Readers skim; provide clean examples first, explanations after
- **Assuming PAM knowledge:** PAM is complex; always explain control flags (required, sufficient, optional)
- **Omitting "why" context:** Security choices need justification (e.g., why HSTS with preload)
- **Single config example:** Provide both minimal and production-ready configurations
- **Forgetting WebSocket specifics:** nginx needs explicit headers; Caddy doesn't (document this difference)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TLS certificates | Manual cert generation, cron renewal | Let's Encrypt + certbot (nginx) or Caddy (built-in) | 90-day expiry, automatic renewal, ACME protocol, revocation handling |
| Flowcharts as images | PNG/SVG diagrams in repo | Mermaid in markdown | Version control, easy updates, GitHub native rendering |
| Service management | Custom init scripts, supervisord | systemd units | Platform standard, dependency management, restart policies, logging integration |
| Security headers | Manual header configuration | OWASP cheat sheet values | Researched policies, defense against known attacks, browser compatibility |
| PAM debug logging | Custom logging, print statements | syslog LOG_AUTH facility with debug flag | Standard logging infrastructure, log rotation, centralized logs |
| WebSocket proxy config | Custom proxy logic | nginx map directive or Caddy defaults | Connection upgrades, timeout handling, header management |

**Key insight:** Deployment documentation is not the place for novel solutions. Users need battle-tested patterns that work reliably. Every custom solution is a support burden and security risk.

## Common Pitfalls

### Pitfall 1: nginx WebSocket Timeouts

**What goes wrong:** WebSocket connections drop after 60 seconds of inactivity
**Why it happens:** nginx default `proxy_read_timeout` is 60s; WebSocket connections are long-lived
**How to avoid:**
```nginx
location /ws {
    proxy_read_timeout 86400s;  # 24 hours
    # OR configure backend to send ping frames < 60s
}
```
**Warning signs:** "502 Bad Gateway" after exactly 60 seconds, clients reconnecting frequently
**Source:** [nginx.org WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)

### Pitfall 2: Express trust proxy Misconfiguration

**What goes wrong:** Rate limiting breaks, IP logging shows proxy IP not client IP
**Why it happens:** Express doesn't trust X-Forwarded-* headers by default; security feature to prevent spoofing
**How to avoid:**
```javascript
// In opencode server config
app.enable('trust proxy');
// ONLY if nginx is trusted and sets X-Forwarded-For
```
**Warning signs:** All requests appear from same IP (127.0.0.1 or proxy IP)
**Documentation note:** Explain security implications - clients can spoof X-Forwarded-For if trust proxy is enabled without actual proxy
**Source:** [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)

### Pitfall 3: PAM Module Load Order

**What goes wrong:** Authentication succeeds when it should fail, or vice versa
**Why it happens:** PAM processes modules top-to-bottom; control flags (required, sufficient, requisite) affect flow
**How to avoid:**
- Document control flag meanings: `required` (must pass, continues), `requisite` (must pass, stops on fail), `sufficient` (if pass, stops), `optional` (result ignored)
- Provide working example configurations, not just isolated lines
- Explain "sufficient" stops processing on success, so order matters
**Warning signs:** Users locked out, wrong PAM modules executing, inconsistent auth results

### Pitfall 4: SELinux Blocking nginx-to-Node.js Connections

**What goes wrong:** nginx returns "502 Bad Gateway", error log shows "(13: Permission denied) while connecting to upstream"
**Why it happens:** Default SELinux policy blocks httpd_t domain from network connections
**How to avoid:**
```bash
# Check if SELinux is enforcing
getenforce
# Enable HTTP network connections
sudo setsebool -P httpd_can_network_connect 1
```
**Warning signs:** nginx config tests fine, backend responds to curl locally, but proxy fails with permission denied
**Documentation note:** Include SELinux troubleshooting section, mention AppArmor as similar issue on Ubuntu
**Source:** [nginx SELinux configuration](https://www.getpagespeed.com/server-setup/nginx/nginx-selinux-configuration)

### Pitfall 5: Forgetting WebSocket Headers in Chained Proxies

**What goes wrong:** WebSocket upgrades fail through Cloudflare + nginx, HTTP fallback or errors
**Why it happens:** Each proxy layer must pass Upgrade/Connection headers; Cloudflare passes them but nginx must too
**How to avoid:**
```nginx
# Even behind Cloudflare, nginx needs these
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```
**Documentation note:** Explicitly document chained proxy scenarios (Cloudflare -> nginx -> opencode)

### Pitfall 6: HSTS with includeSubDomains on Test Domains

**What goes wrong:** Test subdomain gets HSTS cached, can't access via HTTP for debugging
**Why it happens:** `includeSubDomains` applies HSTS to all subdomains; browsers cache for max-age duration
**How to avoid:**
- Use short max-age (300s) for testing
- Only add `includeSubDomains` and `preload` for production
- Document HSTS cannot be "undone" client-side except by waiting for max-age expiry
**Warning signs:** Browser refuses HTTP even after removing HSTS header from server
**Source:** [OWASP HSTS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html)

### Pitfall 7: macOS Monterey PAM Directory Permissions

**What goes wrong:** PAM configuration changes fail or require TCC approval
**Why it happens:** macOS Monterey added restrictions on `/etc/pam.d/` access
**How to avoid:**
- Document macOS-specific TCC requirements
- Explain admin consent is required for processes accessing `/etc/pam.d/`
- Note that system updates may revert `pam.d` and `sshd_config` changes
**Source:** [Monterey PAM permissions](https://jumpcloud.com/blog/granting-permissions-monterey-pluggable-authentication-modules)

## Code Examples

Verified patterns from official sources:

### nginx Reverse Proxy with WebSocket Support
```nginx
# Source: https://nginx.org/en/docs/http/websocket.html
http {
    # Map for conditional Connection header
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    upstream opencode_backend {
        server localhost:3000;
        keepalive 32;  # Connection pooling
    }

    server {
        listen 443 ssl http2;
        server_name <YOUR_DOMAIN>;

        # TLS configuration
        ssl_certificate /etc/letsencrypt/live/<YOUR_DOMAIN>/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/<YOUR_DOMAIN>/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers off;

        # Security headers (OWASP)
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        location / {
            proxy_pass http://opencode_backend;
            proxy_http_version 1.1;

            # WebSocket support
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;

            # Forwarded headers for Express trust proxy
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Long timeout for WebSocket
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name <YOUR_DOMAIN>;
        return 301 https://$server_name$request_uri;
    }
}
```

### Caddy Reverse Proxy (Automatic HTTPS and WebSocket)
```caddyfile
# Source: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
<YOUR_DOMAIN> {
    reverse_proxy localhost:3000 {
        # Graceful WebSocket handling on config reload
        stream_close_delay 5m
        stream_timeout 24h

        # Connection pooling
        transport http {
            keepalive 30s
            keepalive_idle_conns 32
        }
    }

    # Security headers
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```
**Note:** Caddy automatically obtains Let's Encrypt certificates, handles WebSocket upgrades, and sets X-Forwarded-* headers.

### PAM Configuration for opencode
```
# /etc/pam.d/opencode
# Source: PAM documentation patterns

# Authentication
auth required pam_unix.so       # System password check
auth required pam_env.so        # Environment variables

# Account management
account required pam_unix.so

# Password management
password required pam_unix.so
```

### PAM with 2FA (Google Authenticator)
```
# /etc/pam.d/opencode-2fa
# Source: https://github.com/google/google-authenticator-libpam

# Two-factor authentication
auth required pam_google_authenticator.so nullok
# nullok: users without 2FA setup can still login
# Remove nullok to enforce 2FA for all users

auth required pam_unix.so
account required pam_unix.so
```

### systemd Service Unit
```ini
# /etc/systemd/system/opencode.service
# Source: https://www.digitalocean.com/community/tutorials/how-to-deploy-node-js-applications-using-systemd-and-nginx

[Unit]
Description=OpenCode Server
Documentation=https://opencode.ai/docs
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opencode
Group=opencode
WorkingDirectory=/opt/opencode

# Environment
Environment="NODE_ENV=production"
Environment="OPENCODE_PORT=3000"
EnvironmentFile=-/etc/opencode/config

# Execution
ExecStart=/usr/bin/opencode serve --port 3000
Restart=on-failure
RestartSec=10s

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log/opencode /var/lib/opencode

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=opencode

# Resource limits
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### Enable PAM Debug Logging
```bash
# Source: https://access.redhat.com/articles/1314883

# Method 1: Add debug flag to PAM modules
# In /etc/pam.d/opencode, add "debug" option:
auth required pam_unix.so debug

# Method 2: Configure rsyslog to capture LOG_AUTH debug
# Add to /etc/rsyslog.conf:
*.debug /var/log/pam_debug.log

# Disable rate limiting (for rsyslog)
$SystemLogRateLimitInterval 0
$SystemLogRateLimitBurst 0

# Restart logging
sudo systemctl restart rsyslog

# View PAM logs
sudo tail -f /var/log/pam_debug.log
# Or check system auth log
sudo tail -f /var/log/auth.log  # Debian/Ubuntu
sudo tail -f /var/log/secure     # RHEL/CentOS
```

### SELinux Configuration for nginx
```bash
# Source: https://www.getpagespeed.com/server-setup/nginx/nginx-selinux-configuration

# Check SELinux status
getenforce  # Should show "Enforcing"

# Allow nginx to connect to network
sudo setsebool -P httpd_can_network_connect 1

# If using non-standard ports, add to http_port_t
sudo semanage port -a -t http_port_t -p tcp 8080

# Test in permissive mode first (logs violations without blocking)
sudo setenforce 0
# Test your setup
# If working, switch back to enforcing
sudo setenforce 1
```

### Let's Encrypt Setup with nginx
```bash
# Source: https://certbot.eff.org/instructions?ws=nginx

# Install certbot
sudo apt install certbot python3-certbot-nginx  # Debian/Ubuntu
sudo dnf install certbot python3-certbot-nginx  # RHEL/Fedora

# Obtain and install certificate (automatic nginx config)
sudo certbot --nginx -d <YOUR_DOMAIN>

# Or manual mode (you edit nginx config)
sudo certbot certonly --nginx -d <YOUR_DOMAIN>

# Test automatic renewal
sudo certbot renew --dry-run

# Automatic renewal is configured by default via systemd timer
sudo systemctl list-timers | grep certbot
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual cert renewal | Let's Encrypt + auto-renewal | ~2015-2016 | Free TLS, 90-day rotation reduces compromise window |
| supervisord/forever | systemd units | ~2015+ | Native platform integration, better logging/resource control |
| Image-based diagrams | Mermaid in markdown | ~2020+ | Version control, GitHub native rendering, easier updates |
| Single nginx config | Dual format (quick + annotated) | Current best practice | Serves both expert (quick copy) and learning (explanation) needs |
| PAM-only auth | PAM + 2FA (TOTP) | ~2018+ | Defense against credential compromise, zero-trust environments |
| HTTP-only load balancers | TLS termination at LB | Cloud-native shift | Offloads TLS from application, centralized cert management |

**Deprecated/outdated:**
- **pam_ldap.so**: Modern systems use SSSD with pam_sss.so for LDAP authentication (more features, better caching)
- **pm2/forever for production**: systemd provides better integration, logging, and resource control
- **Self-signed certificates in production**: Let's Encrypt provides free, trusted certificates with automation
- **TLS 1.0/1.1**: Deprecated, insecure; use TLSv1.2 minimum, preferably TLSv1.3
- **Expect-CT header**: Deprecated by Chrome, Certificate Transparency is now enforced at browser level

## Open Questions

Things that couldn't be fully resolved:

1. **opencode-broker implementation details**
   - What we know: Referenced in context as needing setuid/setgid, socket permissions, systemd unit documentation
   - What's unclear: Exact socket path, permission requirements, whether broker exists in current codebase
   - Recommendation: Document based on Phase 7 (PAM Integration) implementation; verify broker socket location and permissions during planning

2. **Cloud provider specifics for Hetzner**
   - What we know: Context mentions documenting if Hetzner offers managed TLS/certs
   - What's unclear: Hetzner's managed load balancer TLS termination capabilities (search results focused on AWS/GCP/Azure)
   - Recommendation: Research Hetzner Load Balancer product during writing; if no managed TLS, document self-managed nginx approach

3. **SELinux vs AppArmor coverage depth**
   - What we know: Marked as Claude's discretion; SELinux is well-documented issue with nginx
   - What's unclear: How often AppArmor causes issues vs SELinux in real deployments
   - Recommendation: Prioritize SELinux (RHEL/CentOS/Fedora common for servers), brief AppArmor section (Ubuntu/Debian), based on frequency of nginx permission denied issues (SELinux more common in search results)

4. **Flowchart format/tool depth**
   - What we know: Mermaid is standard, GitHub-native
   - What's unclear: How complex troubleshooting flowcharts should be (simple decision trees vs detailed diagnostic flows)
   - Recommendation: Start with simple 3-5 node decision trees, can expand based on common issues found during UAT

5. **Container deployment scope**
   - What we know: Explicitly deferred to separate phase/doc
   - What's unclear: Should reverse-proxy.md mention "for container deployments, see docker.md" or avoid mentioning containers entirely
   - Recommendation: Brief note "For Docker/container deployments, see [separate doc]" to acknowledge but redirect

## Sources

### Primary (HIGH confidence)
- [nginx.org WebSocket Proxying](https://nginx.org/en/docs/http/websocket.html) - Official nginx WebSocket configuration
- [Caddy reverse_proxy Documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) - Official Caddy reverse proxy directive
- [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html) - Security header recommendations
- [OWASP HSTS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html) - HSTS configuration best practices
- [Express Behind Proxies](https://expressjs.com/en/guide/behind-proxies.html) - Official Express trust proxy documentation
- [Certbot Instructions](https://certbot.eff.org/instructions?ws=nginx) - Official Let's Encrypt + nginx setup
- [GitHub Mermaid Support](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/) - Native GitHub Mermaid rendering
- [Mermaid Official Documentation](https://mermaid.js.org/) - Flowchart syntax and features

### Secondary (MEDIUM confidence)
- [NGINX Reverse Proxy Guide 2025/2026](https://www.getpagespeed.com/server-setup/nginx/nginx-reverse-proxy) - Comprehensive nginx patterns
- [Better Stack: nginx WebSocket SSL](https://betterstack.com/community/questions/nginx-to-reverse-proxy-websockets-and-enable-ssl/) - Community-verified nginx + WSS setup
- [WebSocket.org nginx Guide](https://websocket.org/guides/infrastructure/nginx/) - WebSocket-specific nginx configuration
- [DigitalOcean: Deploy Node.js with systemd and nginx](https://www.digitalocean.com/community/tutorials/how-to-deploy-node-js-applications-using-systemd-and-nginx) - Full deployment walkthrough
- [GitHub: google-authenticator-libpam](https://github.com/google/google-authenticator-libpam) - Official 2FA PAM module
- [Red Hat: Debugging PAM Configuration](https://access.redhat.com/articles/1314883) - PAM debug logging procedures
- [NGINX SELinux Configuration](https://www.getpagespeed.com/server-setup/nginx/nginx-selinux-configuration) - SELinux troubleshooting for nginx
- [CloudBees: Running Node.js with systemd](https://www.cloudbees.com/blog/running-node-js-linux-systemd) - systemd best practices for Node.js
- [Write the Docs: Software Documentation Guide](https://www.writethedocs.org/guide/index.html) - Documentation structure patterns
- [GitBook: Documentation Structure Best Practices](https://gitbook.com/docs/guides/docs-best-practices/documentation-structure-tips) - Modern docs organization
- [opencode-cloud GitHub](https://github.com/pRizz/opencode-cloud) - Service management reference by Peter Ryszkiewicz
- [OpenCode Server Documentation](https://opencode.ai/docs/server/) - Existing opencode documentation style

### Tertiary (LOW confidence)
- Various community tutorials and blog posts for nginx, Caddy, PAM (used for pattern discovery, verified against official sources)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - nginx, Caddy, Mermaid are established with official documentation verified
- Architecture patterns: HIGH - Dual-format examples, progressive disclosure, Mermaid flowcharts verified from multiple current sources
- Security headers: HIGH - OWASP cheat sheets are authoritative, updated January 2026
- WebSocket configuration: HIGH - Verified from official nginx and Caddy documentation
- PAM configuration: MEDIUM - Multiple sources agree, but broker-specific details need Phase 7 verification
- Cloud provider specifics: MEDIUM - AWS/GCP/Azure verified, Hetzner needs additional research
- Pitfalls: HIGH - Verified from official docs and community issue trackers (SELinux, Express trust proxy, HSTS)

**Research date:** 2026-01-25
**Valid until:** 60 days (March 2026) - nginx/Caddy stable, OWASP recommendations change slowly, Mermaid is mature
