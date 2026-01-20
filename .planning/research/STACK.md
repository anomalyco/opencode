# Technology Stack: PAM-Based System Authentication

**Project:** Opencode System Authentication
**Researched:** 2026-01-19
**Overall Confidence:** MEDIUM (some recommendations based on training data, need runtime verification)

## Executive Summary

Adding PAM-based system authentication to opencode requires:
1. A native PAM binding for Node.js/Bun
2. Session management via secure cookies (Hono built-in)
3. CSRF protection (Hono built-in)
4. User impersonation for command execution

The primary challenge is PAM integration with Bun runtime. PAM libraries use native bindings (N-API/node-gyp), and Bun's native module compatibility is improving but not complete. The recommended approach is to use a setuid helper binary for PAM authentication, similar to Cockpit's architecture, which also provides the privilege separation needed for user impersonation.

## Recommended Stack

### Core Framework (Already Present)

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| Hono | 4.10.7 | HTTP server, middleware | HIGH - already in codebase |
| Bun | 1.3.5 | Runtime | HIGH - already in codebase |
| TypeScript | 5.8.2 | Type safety | HIGH - already in codebase |
| Zod | 4.1.8 | Schema validation | HIGH - already in codebase |

**Rationale:** No framework changes needed. Hono provides all required middleware for cookies, CSRF, and secure headers.

### PAM Integration

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| authenticate-pam | ~1.1.1 | PAM authentication (Node.js) | LOW - needs Bun compatibility testing |
| Custom setuid helper | N/A | PAM auth + user impersonation | MEDIUM - Cockpit-proven pattern |

**Recommendation:** Build a setuid helper binary approach.

**Rationale:**
- Direct PAM libraries (`authenticate-pam`, `node-linux-pam`) use native N-API bindings
- Bun's native module support is improving but has edge cases
- A setuid helper binary provides:
  - Clean privilege separation (server runs unprivileged, helper runs as root for PAM)
  - User impersonation built-in (spawn processes as authenticated user)
  - No native module compatibility concerns
  - Matches Cockpit's battle-tested architecture

**Alternative considered - direct PAM library:**
```typescript
// authenticate-pam approach (if Bun N-API works)
import { authenticate } from "authenticate-pam"

// Async callback-based API
authenticate(username, password, (err) => {
  if (err) {
    // Authentication failed
  } else {
    // Success
  }
})
```

**Why NOT direct library:**
- `authenticate-pam` last published ~2020 (npm), uncertain maintenance
- `node-linux-pam` also uses native bindings, same Bun concerns
- Direct PAM in server process requires root privileges throughout
- No clean path to user impersonation for command execution

### Session Management

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| hono/cookie | 4.10.7 (built-in) | Signed session cookies | HIGH - verified in codebase |
| ulid | 3.0.1 | Session ID generation | HIGH - already in codebase |

**Rationale:** Hono's built-in cookie helper supports signed cookies via `setSignedCookie`/`getSignedCookie`, eliminating need for external session libraries.

```typescript
import { setSignedCookie, getSignedCookie, deleteCookie } from "hono/cookie"

// Set session cookie
await setSignedCookie(c, "session", sessionId, secret, {
  httpOnly: true,
  secure: true,  // Requires HTTPS
  sameSite: "Lax",
  maxAge: 86400, // 24 hours
  path: "/",
})

// Get and verify session cookie
const sessionId = await getSignedCookie(c, secret, "session")
if (sessionId === false) {
  // Signature verification failed (tampering)
}
```

### Security Middleware

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| hono/csrf | 4.10.7 (built-in) | CSRF protection | HIGH - verified in codebase |
| hono/secure-headers | 4.10.7 (built-in) | Security headers (CSP, etc.) | HIGH - verified in codebase |

**Rationale:** Hono includes modern CSRF protection using origin/Sec-Fetch-Site validation, no tokens needed.

```typescript
import { csrf } from "hono/csrf"
import { secureHeaders } from "hono/secure-headers"

app.use(csrf())  // Validates origin for state-changing requests
app.use(secureHeaders())  // Adds X-Frame-Options, CSP, etc.
```

### User Impersonation (Command Execution)

| Technology | Version | Purpose | Confidence |
|------------|---------|---------|------------|
| Node.js child_process | N/A | Process spawning | HIGH - standard API |
| setuid/setgid syscalls | N/A | UID switching | MEDIUM - requires root/capabilities |

**Architecture choice:** Setuid helper approach

The server needs to execute commands as the authenticated user, not as root. Two approaches:

**Option A: Server as root with setuid (NOT recommended)**
- Server runs as root
- Spawns processes, calls setuid before exec
- Risk: Any server vulnerability = full root access

**Option B: Setuid helper binary (Recommended - Cockpit pattern)**
- Server runs as unprivileged user
- Communicates with setuid helper over Unix socket
- Helper handles: PAM auth, session creation, command spawning
- Security boundary maintained

```
[Browser] <--HTTPS--> [Hono Server (unprivileged)]
                            |
                      [Unix Socket]
                            |
                      [setuid helper (root)]
                            |
                      [spawns shell as user]
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| PAM | Setuid helper | authenticate-pam | Bun compatibility unknown, no privilege separation |
| Session | Hono signed cookies | iron-session, lucia | Extra dependency, Hono built-in sufficient |
| CSRF | Hono csrf middleware | Double-submit tokens | Origin validation is modern standard, simpler |
| Auth | PAM | OAuth/OIDC | PAM integrates with existing enterprise auth (LDAP/Kerberos) |

## What NOT to Use

### DO NOT use: Basic Authentication for PAM

The existing `basicAuth` middleware in server.ts is for simple password protection. Do NOT extend it for PAM:

```typescript
// WRONG - Don't do this
.use(basicAuth({
  verifyUser: async (username, password) => {
    return await pamAuthenticate(username, password) // Bad pattern
  }
}))
```

**Why:** Basic auth sends credentials on every request, cannot support sessions, poor UX.

### DO NOT use: JWT for sessions

JWTs are popular but wrong for this use case:

- Cannot be invalidated server-side without blocklist
- "Remember me" becomes complex
- Larger than session ID cookies
- Overkill for single-server self-hosted

### DO NOT use: Passport.js

- Heavy, designed for OAuth providers
- PAM strategy exists but poorly maintained
- Hono middleware pattern doesn't align well

## Installation

No new npm packages required for core functionality. The setuid helper is a separate binary (C or Rust).

```bash
# Existing dependencies already provide:
# - hono (cookie, csrf, secure-headers)
# - ulid (session ID generation)
# - zod (validation)

# No new runtime dependencies
```

### Setuid Helper (Separate Build)

The helper binary should be:
- Written in C or Rust for minimal dependencies
- Statically linked where possible
- Installed with setuid bit: `chmod u+s /usr/local/bin/opencode-auth-helper`

## Configuration Schema

Add to `opencode.json`:

```typescript
// packages/opencode/src/config/config.ts addition
const AuthConfig = z.object({
  enabled: z.boolean().default(false),
  sessionTimeout: z.number().default(86400), // 24 hours in seconds
  rememberMeTimeout: z.number().default(604800), // 7 days
  allowedUsers: z.array(z.string()).optional(), // null = all PAM users
  requireHttps: z.boolean().default(true),
  helperPath: z.string().default("/usr/local/bin/opencode-auth-helper"),
})
```

## Implementation Priority

1. **Session infrastructure** (Hono cookies, session store) - can prototype immediately
2. **Auth middleware** (route protection) - can prototype with mock auth
3. **Setuid helper** (PAM + impersonation) - requires C/Rust development
4. **Login UI** (SolidJS frontend) - can develop in parallel
5. **Integration testing** - requires Linux VM with PAM

## Open Questions (Need Phase-Specific Research)

| Question | Impact | When to Investigate |
|----------|--------|---------------------|
| Bun N-API compatibility with authenticate-pam | Could simplify if works | Early prototype phase |
| macOS PAM differences | Secondary platform support | After Linux works |
| Setuid helper IPC protocol | Core architecture | Architecture phase |
| PTY ownership with user impersonation | bun-pty compatibility | PTY integration phase |

## Sources

- Hono documentation (verified via installed package.json, v4.10.7)
- Hono middleware types (verified via dist/types in node_modules)
- Existing opencode codebase (server.ts, pty/index.ts, auth/index.ts)
- Cockpit architecture (training data - MEDIUM confidence)
- PAM library landscape (training data - LOW confidence, needs verification)
- Bun native module compatibility (training data - LOW confidence, evolving)

---
*Note: WebSearch and WebFetch unavailable during research. PAM library versions and current maintenance status should be verified before implementation.*
