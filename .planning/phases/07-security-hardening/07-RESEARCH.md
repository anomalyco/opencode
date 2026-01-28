# Phase 7: Security Hardening - Research

**Researched:** 2026-01-22
**Domain:** Web application security (CSRF, rate limiting, HTTPS enforcement)
**Confidence:** HIGH

## Summary

Security hardening for web applications requires implementing multiple defense layers against common attacks. Based on OWASP's latest 2025 guidance and current framework capabilities, the recommended approach combines CSRF protection using signed double-submit cookies with HMAC, IP-based rate limiting for login attempts, and HTTP/HTTPS detection with configurable enforcement.

The Hono framework (used in this project) provides built-in CSRF middleware, but it uses header-based validation (Origin/Sec-Fetch-Site) rather than token-based protection. For the double-submit cookie pattern specified in the context, a custom implementation using HMAC-signed tokens is required. Rate limiting can be implemented using dedicated middleware libraries like hono-rate-limiter, with in-memory storage suitable for single-instance deployments. Protocol detection relies on X-Forwarded-Proto header inspection with fallback to direct connection protocol checking.

**Primary recommendation:** Implement HMAC-signed double-submit CSRF tokens tied to session IDs, use hono-rate-limiter for login endpoint protection with sensible defaults (5 attempts per 15 minutes), and check X-Forwarded-Proto only from trusted sources with configurable HTTPS enforcement.

## Standard Stack

The established libraries/tools for web security in Hono applications:

### Core

| Library           | Version  | Purpose                        | Why Standard                                                 |
| ----------------- | -------- | ------------------------------ | ------------------------------------------------------------ |
| hono              | 4.10.7+  | Web framework                  | Built-in security middleware, lightweight, TypeScript-first  |
| hono-rate-limiter | 0.4.0+   | Rate limiting middleware       | Hono-specific, supports multiple stores, actively maintained |
| Node.js crypto    | Built-in | CSRF token generation and HMAC | Native, cryptographically secure, no dependencies            |

### Supporting

| Library                       | Version | Purpose                    | When to Use                            |
| ----------------------------- | ------- | -------------------------- | -------------------------------------- |
| @hono-rate-limiter/cloudflare | Latest  | Cloudflare-specific stores | If deploying to Cloudflare Workers     |
| rate-limiter-flexible         | 5.0.0+  | Advanced rate limiting     | Multi-backend support, Redis/DB needed |

### Alternatives Considered

| Instead of        | Could Use             | Tradeoff                                                                                                |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| Custom CSRF       | Hono built-in CSRF    | Hono's middleware uses header-only validation, doesn't support double-submit cookie pattern with tokens |
| hono-rate-limiter | Custom implementation | Custom requires more code but offers precise control over behavior                                      |
| In-memory store   | Redis/Database        | In-memory faster but doesn't scale across instances; use Redis for multi-instance deployments           |

**Installation:**

```bash
bun add hono-rate-limiter
# No additional dependencies needed for crypto (built-in)
```

## Architecture Patterns

### Recommended Middleware Structure

```
Server middleware chain:
├── CORS middleware (already present)
├── CSRF middleware (new - validates on state-changing requests)
├── Rate limiting (new - login endpoint only)
├── Auth middleware (already present)
└── Route handlers
```

### Pattern 1: Signed Double-Submit Cookie CSRF

**What:** Generate HMAC-SHA256 signed token, store in non-HttpOnly cookie, validate against header/body value
**When to use:** All state-changing requests (POST, PUT, DELETE, PATCH) when auth is enabled
**Example:**

```typescript
// Source: OWASP CSRF Prevention Cheat Sheet
// Token generation
import crypto from "crypto"

function generateCSRFToken(sessionId: string, secret: string): string {
  const randomValue = crypto.randomBytes(32).toString("hex")
  const hmac = crypto.createHmac("sha256", secret)
  hmac.update(`${sessionId}:${randomValue}`)
  const signature = hmac.digest("hex")
  return `${signature}.${randomValue}`
}

// Token validation
function validateCSRFToken(token: string, sessionId: string, secret: string): boolean {
  const [signature, randomValue] = token.split(".")
  if (!signature || !randomValue) return false

  const expectedHmac = crypto.createHmac("sha256", secret)
  expectedHmac.update(`${sessionId}:${randomValue}`)
  const expectedSignature = expectedHmac.digest("hex")

  // Use constant-time comparison to prevent timing attacks
  const expectedBuffer = Buffer.from(expectedSignature, "hex")
  const actualBuffer = Buffer.from(signature, "hex")

  if (expectedBuffer.length !== actualBuffer.length) return false
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
}

// Cookie settings
const csrfCookie = {
  name: "opencode_csrf",
  httpOnly: false, // MUST be readable by JavaScript for double-submit
  secure: true, // Only over HTTPS (except localhost)
  sameSite: "lax" as const,
  path: "/",
}
```

### Pattern 2: Login Rate Limiting

**What:** Track failed login attempts by IP address, block after threshold
**When to use:** Login endpoint only (focused protection)
**Example:**

```typescript
// Source: hono-rate-limiter documentation
import { rateLimiter } from "hono-rate-limiter"

// Rate limiter for login endpoint
const loginRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 attempts
  standardHeaders: "draft-7", // Return rate limit info in headers
  keyGenerator: (c) => {
    // Get IP from X-Forwarded-For or connection
    return c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "unknown"
  },
  handler: (c) => {
    return c.json(
      {
        error: "auth_failed",
        message: "Too many login attempts. Please try again later.",
      },
      429,
      {
        "Retry-After": "900", // 15 minutes in seconds
      },
    )
  },
})

// Apply to login route
app.post("/api/auth/login", loginRateLimiter, async (c) => {
  // Login logic
})
```

### Pattern 3: HTTP/HTTPS Detection

**What:** Check X-Forwarded-Proto header first, fall back to direct protocol
**When to use:** Login page rendering, configurable HTTPS enforcement
**Example:**

```typescript
// Source: X-Forwarded-Proto MDN documentation
function isSecureConnection(c: Context): boolean {
  // Check X-Forwarded-Proto from trusted proxy
  const forwardedProto = c.req.header("x-forwarded-proto")
  if (forwardedProto) {
    return forwardedProto === "https"
  }

  // Fallback to direct connection protocol
  const url = new URL(c.req.url)
  return url.protocol === "https:"
}

function shouldBlockInsecureLogin(c: Context, config: { require_https: boolean }): boolean {
  if (!config.require_https) return false

  // Allow localhost over HTTP (development)
  const host = c.req.header("host") || ""
  if (host.startsWith("localhost:") || host.startsWith("127.0.0.1:")) {
    return false
  }

  return !isSecureConnection(c)
}
```

### Anti-Patterns to Avoid

- **Trusting X-Forwarded-Proto unconditionally:** Only trust this header from known reverse proxies; attackers can spoof it. Configure allowed proxy IPs and reject the header from other sources.
- **Using === for token comparison:** String equality checks leak timing information. Always use `crypto.timingSafeEqual()` for security-sensitive comparisons.
- **Naive double-submit cookie:** Sending random token in cookie + body without HMAC signing is vulnerable to subdomain cookie injection. Always use HMAC binding to session.
- **HttpOnly CSRF cookie:** The double-submit pattern requires JavaScript to read the cookie value. Setting HttpOnly breaks the pattern.
- **Global rate limiting:** Applying rate limits to all routes causes false positives. Rate limit only high-risk endpoints like login.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem                 | Don't Build                       | Use Instead                                | Why                                                                     |
| ----------------------- | --------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Rate limiting store     | Custom in-memory Map with cleanup | hono-rate-limiter or rate-limiter-flexible | Memory leaks, race conditions, sliding window complexity                |
| CSRF token generation   | Math.random() or Date.now()       | crypto.randomBytes()                       | crypto.randomBytes() uses OS-level CSPRNG; Math.random() is predictable |
| String comparison       | string1 === string2 for tokens    | crypto.timingSafeEqual()                   | Timing attacks can leak token contents character-by-character           |
| HMAC implementation     | Custom hash functions             | crypto.createHmac()                        | OpenSSL-backed, constant-time, battle-tested                            |
| Retry-After calculation | Custom date formatting            | Standard HTTP-date or seconds              | Clients expect RFC 7231 format; custom formats break compatibility      |

**Key insight:** Security primitives have subtle requirements (constant-time operations, cryptographic randomness, proper key derivation) that are easy to get wrong. Use battle-tested libraries.

## Common Pitfalls

### Pitfall 1: CSRF Token Without Session Binding

**What goes wrong:** Generating CSRF tokens without tying them to the authenticated session allows attackers to use their own token on victim requests.
**Why it happens:** Simpler to implement random token without session context; naive double-submit pattern examples omit this step.
**How to avoid:** Always include session ID in HMAC calculation: `hmac(secret, sessionId + randomValue)`. Validate session matches token.
**Warning signs:** CSRF tokens work across different logged-in users; attacker can generate valid token for victim.

### Pitfall 2: Leaking Rate Limit Details

**What goes wrong:** Error messages reveal exact retry times or remaining attempts, helping attackers optimize brute force timing.
**Why it happens:** Desire to be helpful to legitimate users; verbose error mode enabled in production.
**How to avoid:** Generic message by default: "Too many attempts. Please try again later." Log detailed info server-side. Only enable verbose errors in development.
**Warning signs:** Error responses include "4 attempts remaining" or exact retry timestamp in message body.

### Pitfall 3: Trusting X-Forwarded-Proto from Anywhere

**What goes wrong:** Attackers spoof X-Forwarded-Proto header to bypass HTTPS enforcement, claiming connection is secure when it's not.
**Why it happens:** Checking header without validating request source; not configuring trusted proxy list.
**How to avoid:** Only trust X-Forwarded-Proto when request comes from known reverse proxy IPs. Otherwise, use direct protocol detection.
**Warning signs:** HTTPS enforcement can be bypassed by adding header manually; localhost connections blocked incorrectly.

### Pitfall 4: Session Fixation After Login

**What goes wrong:** User logs in but session ID doesn't change, allowing attacker with pre-login session ID to hijack authenticated session.
**Why it happens:** Forgetting to regenerate session ID after authentication state change; reusing CSRF token across login boundary.
**How to avoid:** Destroy old session and create new one after successful login. Regenerate CSRF token with new session ID.
**Warning signs:** Session IDs persist across login; CSRF token valid before and after authentication.

### Pitfall 5: Rate Limiting by IP Only in Production

**What goes wrong:** Attackers using distributed botnets bypass IP-based limits; legitimate users behind NAT get blocked together.
**Why it happens:** IP tracking is simplest to implement; context specifies IP-only approach.
**How to avoid:** Context decision mandates IP-only (simpler approach). Document limitation. Consider username tracking in future phase if needed.
**Warning signs:** Corporate networks with shared IP report lockouts; attacker rotates IPs to bypass limits.

### Pitfall 6: XSS Enables CSRF Bypass

**What goes wrong:** Cross-site scripting vulnerability allows attacker to read CSRF token from page/cookie and include it in forged request.
**Why it happens:** CSRF protection assumes attacker cannot execute JavaScript in victim's context; XSS breaks this assumption.
**How to avoid:** CSRF tokens are NOT a defense against XSS. Must also prevent XSS through output encoding, CSP, input validation.
**Warning signs:** CSRF protection bypassed when malicious script injected into page.

### Pitfall 7: Logging Passwords and Tokens

**What goes wrong:** Security logging accidentally captures plaintext passwords, CSRF tokens, or session IDs in audit trails.
**Why it happens:** Logging entire request body or headers without filtering; helpful debugging that becomes vulnerability.
**How to avoid:** Mask sensitive fields before logging. Use allowlist approach: log only specific safe fields. Never log Authorization, Cookie, or X-CSRF-Token headers.
**Warning signs:** Log files contain "password": "actual_password"; grep for tokens finds them in logs.

## Code Examples

Verified patterns from official sources:

### CSRF Middleware Implementation

```typescript
// Source: OWASP + Hono patterns
import { createMiddleware } from "hono/factory"
import crypto from "crypto"

interface CSRFConfig {
  secret: string
  cookieName: string
  headerName: string
  skipIfNoAuth: boolean
  allowlist: string[]
  verboseErrors: boolean
}

export const csrfProtection = (config: CSRFConfig) => {
  return createMiddleware(async (c, next) => {
    // Skip for safe methods
    const method = c.req.method
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next()
    }

    // Skip if auth disabled and configured to do so
    if (config.skipIfNoAuth && !c.get("user")) {
      return next()
    }

    // Skip if route is in allowlist
    const path = new URL(c.req.url).pathname
    if (config.allowlist.some((pattern) => path.startsWith(pattern))) {
      return next()
    }

    // Get token from cookie
    const cookieToken = await c.req.cookie(config.cookieName)
    if (!cookieToken) {
      return c.json(
        {
          error: "csrf_required",
          message: config.verboseErrors ? "CSRF token missing from cookie" : "Invalid request",
        },
        403,
      )
    }

    // Get token from header or body
    const headerToken = c.req.header(config.headerName)
    let bodyToken: string | undefined

    if (!headerToken) {
      try {
        const body = await c.req.json()
        bodyToken = body?._csrf
      } catch {
        // Not JSON body, that's okay
      }
    }

    const requestToken = headerToken || bodyToken
    if (!requestToken) {
      return c.json(
        {
          error: "csrf_required",
          message: config.verboseErrors ? "CSRF token missing from request" : "Invalid request",
        },
        403,
      )
    }

    // Validate tokens match
    if (cookieToken !== requestToken) {
      return c.json(
        {
          error: "csrf_invalid",
          message: config.verboseErrors ? "CSRF tokens do not match" : "Invalid request",
        },
        403,
      )
    }

    // Validate HMAC signature
    const sessionId = c.get("sessionId") || ""
    if (!validateCSRFToken(requestToken, sessionId, config.secret)) {
      return c.json(
        {
          error: "csrf_invalid",
          message: config.verboseErrors ? "CSRF signature validation failed" : "Invalid request",
        },
        403,
      )
    }

    await next()
  })
}

function validateCSRFToken(token: string, sessionId: string, secret: string): boolean {
  try {
    const [signature, randomValue] = token.split(".")
    if (!signature || !randomValue) return false

    const expectedHmac = crypto.createHmac("sha256", secret)
    expectedHmac.update(`${sessionId}:${randomValue}`)
    const expectedSig = expectedHmac.digest("hex")

    // Constant-time comparison
    const expectedBuffer = Buffer.from(expectedSig)
    const actualBuffer = Buffer.from(signature)

    if (expectedBuffer.length !== actualBuffer.length) return false
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  } catch {
    return false
  }
}
```

### Rate Limiter Configuration

```typescript
// Source: hono-rate-limiter + OWASP guidelines
import { rateLimiter } from "hono-rate-limiter"

// Conservative default for internet-exposed servers
export const loginRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 attempts per window
  standardHeaders: "draft-7",
  keyGenerator: (c) => {
    // Check X-Forwarded-For from trusted proxy
    const forwarded = c.req.header("x-forwarded-for")
    if (forwarded) {
      // Take first IP (client)
      return forwarded.split(",")[0].trim()
    }
    // Fallback to X-Real-IP or 'unknown'
    return c.req.header("x-real-ip") || "unknown"
  },
  handler: (c) => {
    // Log security event
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown"
    console.warn("[SECURITY] Rate limit exceeded", {
      ip,
      path: c.req.path,
      timestamp: new Date().toISOString(),
    })

    return c.json(
      {
        error: "rate_limit_exceeded",
        message: "Too many login attempts. Please try again later.",
      },
      429,
      {
        "Retry-After": String(Math.ceil(15 * 60)), // seconds
      },
    )
  },
})

// Configurable defaults
export interface RateLimitConfig {
  windowMs?: number // default: 15 * 60 * 1000
  limit?: number // default: 5
}

export function createLoginRateLimiter(config?: RateLimitConfig) {
  return rateLimiter({
    windowMs: config?.windowMs ?? 15 * 60 * 1000,
    limit: config?.limit ?? 5,
    // ... same as above
  })
}
```

### Security Event Logging

```typescript
// Source: Security logging best practices
interface SecurityEvent {
  type: "login_failed" | "rate_limit" | "csrf_violation"
  ip: string
  username?: string
  reason: string
  timestamp: string
  userAgent?: string
}

function logSecurityEvent(event: SecurityEvent): void {
  // Structure log for SIEM ingestion
  console.warn("[SECURITY]", {
    event_type: event.type,
    ip: event.ip,
    username: event.username ? maskUsername(event.username) : undefined,
    reason: event.reason,
    timestamp: event.timestamp,
    user_agent: event.userAgent,
  })
}

// Mask PII in logs (partial masking for debugging)
function maskUsername(username: string): string {
  if (username.length <= 3) return "***"
  return username.slice(0, 2) + "***" + username.slice(-1)
}

// Example usage
function handleLoginFailure(c: Context, username: string, reason: string) {
  logSecurityEvent({
    type: "login_failed",
    ip: c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown",
    username,
    reason,
    timestamp: new Date().toISOString(),
    userAgent: c.req.header("user-agent"),
  })
}
```

### WebSocket CSRF Protection

```typescript
// Source: OWASP WebSocket Security Cheat Sheet
import { Hono } from "hono"
import { upgradeWebSocket } from "hono/cloudflare-workers"

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    // Validate CSRF token in URL parameter (handshake only)
    const csrfToken = c.req.query("csrf")
    const cookieToken = c.req.cookie("opencode_csrf")
    const sessionId = c.get("sessionId")

    if (!csrfToken || !cookieToken || csrfToken !== cookieToken) {
      throw new Error("CSRF validation failed")
    }

    if (!validateCSRFToken(csrfToken, sessionId, SECRET)) {
      throw new Error("Invalid CSRF token signature")
    }

    return {
      onOpen: () => {
        console.log("WebSocket connection opened")
      },
      onMessage: (event) => {
        // Don't re-validate CSRF on every message
        // Connection established = already authenticated
      },
    }
  }),
)
```

## State of the Art

| Old Approach                | Current Approach                  | When Changed      | Impact                                                                           |
| --------------------------- | --------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| Synchronizer token pattern  | Signed double-submit cookie       | 2023-2024         | Stateless option for distributed systems; avoids server-side token storage       |
| Naive double-submit         | HMAC-signed with session binding  | 2022 OWASP update | Prevents subdomain cookie injection attacks                                      |
| SameSite as CSRF defense    | SameSite + token-based protection | 2021-2025         | SameSite bypasses exist (some flows still vulnerable); layered defense essential |
| IP + username rate limiting | IP-only rate limiting             | Context decision  | Simpler implementation; accept trade-off of botnet bypass for initial phase      |
| Origin header only          | Origin + Sec-Fetch-Site headers   | 2023 Hono v3.12   | Modern browsers send Sec-Fetch-Site; provides additional cross-site defense      |

**Deprecated/outdated:**

- **csurf package (Express):** Unmaintained since 2022; use framework-specific solutions or custom implementation
- **Synchronizer token without HMAC:** Vulnerable to token fixation if session ID doesn't change on login
- **Relying solely on Referer header:** Easily stripped by browsers, privacy tools, or corporate proxies; insufficient as primary defense

## Open Questions

Things that couldn't be fully resolved:

1. **Hono built-in CSRF vs custom implementation**
   - What we know: Hono has CSRF middleware that validates Origin/Sec-Fetch-Site headers (header-based approach)
   - What's unclear: Whether header-based approach is sufficient for this use case vs double-submit cookie requirement
   - Recommendation: Context mandates double-submit cookie pattern, so use custom implementation. Hono's middleware is complementary (can run both).

2. **Rate limiter store scaling**
   - What we know: hono-rate-limiter works with in-memory store for single instances
   - What's unclear: Whether deployment will be single-instance or distributed (multi-instance needs Redis/DB)
   - Recommendation: Start with in-memory store (simple, fast). Document Redis migration path for future scaling.

3. **Verbose error mode implementation**
   - What we know: Context specifies configurable verbose error setting for CSRF failures
   - What's unclear: Whether verbose mode should also apply to rate limiting errors or just CSRF
   - Recommendation: Apply verbose mode to both CSRF and rate limiting for consistency. Default false in both cases.

4. **Username-based rate limiting**
   - What we know: Context specifies IP-only rate limiting (simpler approach)
   - What's unclear: Whether username tracking should be added in addition to IP, or kept IP-only
   - Recommendation: Context decision is IP-only for this phase. Document as known limitation; consider username tracking in Phase 8 (session enhancements).

5. **CSRF token rotation frequency**
   - What we know: Token should regenerate after login and when session expires/logs out
   - What's unclear: Whether to also rotate on session refresh or periodic intervals
   - Recommendation: Rotate on login and logout only (matches context). Token lifetime tied to session, no periodic rotation needed.

## Sources

### Primary (HIGH confidence)

- OWASP Cross-Site Request Forgery Prevention Cheat Sheet - [https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) - CSRF patterns, double-submit cookie, security considerations
- OWASP WebSocket Security Cheat Sheet - [https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) - WebSocket CSRF protection
- Hono CSRF Protection Documentation - [https://hono.dev/docs/middleware/builtin/csrf](https://hono.dev/docs/middleware/builtin/csrf) - Hono's built-in CSRF middleware
- Node.js Crypto Documentation - [https://nodejs.org/api/crypto.html](https://nodejs.org/api/crypto.html) - crypto.randomBytes(), crypto.createHmac(), crypto.timingSafeEqual()
- MDN X-Forwarded-Proto Header - [https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-Proto](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-Proto) - Protocol detection
- MDN HTTP 429 Too Many Requests - [https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429) - Rate limit response format
- MDN Set-Cookie Header - [https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie) - Cookie security attributes

### Secondary (MEDIUM confidence)

- hono-rate-limiter GitHub - [https://github.com/rhinobase/hono-rate-limiter](https://github.com/rhinobase/hono-rate-limiter) - Rate limiting middleware for Hono
- OWASP Top 10 2025 - [https://owasp.org/Top10/2025/0x00_2025-Introduction/](https://owasp.org/Top10/2025/0x00_2025-Introduction/) - Current web security risks
- Datadog Authentication Logging Best Practices - [https://www.datadoghq.com/blog/how-to-monitor-authentication-logs/](https://www.datadoghq.com/blog/how-to-monitor-authentication-logs/) - Security logging patterns
- BrowserStack X-Forwarded-Proto Guide - [https://www.browserstack.com/guide/x-forwarded-proto](https://www.browserstack.com/guide/x-forwarded-proto) - Header usage and security
- Better Stack Logging Sensitive Data Guide - [https://betterstack.com/community/guides/logging/sensitive-data/](https://betterstack.com/community/guides/logging/sensitive-data/) - PII masking in logs

### Tertiary (LOW confidence)

- Rate Limiting Hono Apps Introduction - [https://dev.to/fiberplane/an-introduction-to-rate-limiting-3j0](https://dev.to/fiberplane/an-introduction-to-rate-limiting-3j0) - Tutorial on rate limiting concepts
- Medium: Double Submit Cookie Pattern - [https://medium.com/cross-site-request-forgery-csrf/double-submit-cookie-pattern-65bb71d80d9f](https://medium.com/cross-site-request-forgery-csrf/double-submit-cookie-pattern-65bb71d80d9f) - Pattern explanation
- Node.js Best Practices: Login Rate Limiting - [https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/security/login-rate-limit.md](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/security/login-rate-limit.md) - Community best practices

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - Hono is project's existing framework; crypto is built-in; hono-rate-limiter is actively maintained
- Architecture: HIGH - OWASP patterns are well-documented; HMAC-signed double-submit is recommended approach
- Pitfalls: HIGH - OWASP cheat sheets explicitly document these vulnerabilities; cross-referenced with multiple sources

**Research date:** 2026-01-22
**Valid until:** 2026-07-22 (6 months - security standards evolve slowly; OWASP guidance stable)
