# Phase 2: Session Infrastructure - Research

**Researched:** 2026-01-20
**Domain:** HTTP session management, secure cookies, in-memory session storage
**Confidence:** HIGH

## Summary

This research examines how to implement session infrastructure for the opencode authentication system. The codebase already uses Hono as its HTTP framework with established patterns for middleware, routes, and cookie handling. Phase 1 established the auth configuration schema including `sessionTimeout` (default 7d) as a duration string.

Key findings:
- Hono provides built-in `setCookie`, `getCookie`, `deleteCookie` helpers with full security option support
- Session IDs should be generated via `crypto.randomUUID()` (Bun-native, cryptographically secure)
- In-memory session storage using a `Map` is appropriate for the MVP (per CONTEXT.md decisions)
- Idle timeout with sliding expiration is achieved by updating `lastAccessTime` on each request
- The existing `basicAuth` middleware pattern in `server.ts` shows how to conditionally apply auth

**Primary recommendation:** Create a `Session` namespace with in-memory Map storage, session middleware using Hono's `createMiddleware`, and auth routes following existing route patterns.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | 4.10.7 | HTTP framework with cookie helpers | Already used in codebase |
| hono/cookie | (bundled) | setCookie, getCookie, deleteCookie | Built-in, type-safe |
| hono/factory | (bundled) | createMiddleware for type-safe middleware | Built-in, enables typed context |
| crypto | (Bun native) | randomUUID() for session IDs | Cryptographically secure, no dependencies |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ms | 2.1.3 | Parse duration strings to milliseconds | Already installed, used by Duration utility |
| hono/csrf | (bundled) | CSRF protection middleware | For logout POST endpoint |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-memory Map | @hono/session | More features but adds complexity; Map is simpler per CONTEXT.md |
| crypto.randomUUID | nanoid | nanoid shorter but UUID standard and sufficient |
| Custom session store | hono-kv-session | KV-based is more scalable but in-memory acceptable per decisions |

**Installation:**
No new dependencies required - all functionality available in existing stack.

## Architecture Patterns

### Recommended Project Structure
```
packages/opencode/src/
├── session/
│   └── user-session.ts       # NEW: User session management (distinct from AI session)
├── server/
│   ├── middleware/
│   │   └── auth.ts           # NEW: Authentication middleware
│   └── routes/
│       └── auth.ts           # NEW: Auth routes (login, logout)
├── config/
│   └── auth.ts               # EXISTING: AuthConfig schema
└── util/
    └── duration.ts           # EXISTING: parseDuration utility
```

Note: The codebase already has a `session/` directory for AI conversation sessions. The user authentication session should be named distinctly to avoid confusion (e.g., `UserSession` or placed in a different location like `server/session.ts`).

### Pattern 1: Session Store as Namespace with Map
**What:** Namespace containing session storage Map and CRUD operations
**When to use:** Any in-memory state management
**Example:**
```typescript
// Source: Follows auth/index.ts pattern
export namespace UserSession {
  export const Info = z.object({
    id: z.string(),
    username: z.string(),
    createdAt: z.number(),
    lastAccessTime: z.number(),
    userAgent: z.string().optional(),
  }).meta({ ref: "UserSessionInfo" })

  export type Info = z.infer<typeof Info>

  // In-memory storage - sessions lost on restart (acceptable per CONTEXT.md)
  const sessions = new Map<string, Info>()

  export function create(username: string, userAgent?: string): Info {
    const session: Info = {
      id: crypto.randomUUID(),
      username,
      createdAt: Date.now(),
      lastAccessTime: Date.now(),
      userAgent,
    }
    sessions.set(session.id, session)
    return session
  }

  export function get(id: string): Info | undefined {
    return sessions.get(id)
  }

  export function touch(id: string): boolean {
    const session = sessions.get(id)
    if (!session) return false
    session.lastAccessTime = Date.now()
    return true
  }

  export function remove(id: string): boolean {
    return sessions.delete(id)
  }

  export function removeAllForUser(username: string): number {
    let count = 0
    for (const [id, session] of sessions) {
      if (session.username === username) {
        sessions.delete(id)
        count++
      }
    }
    return count
  }
}
```

### Pattern 2: Authentication Middleware with createMiddleware
**What:** Type-safe middleware that validates session and sets context
**When to use:** Routes requiring authentication
**Example:**
```typescript
// Source: https://hono.dev/docs/helpers/factory
import { createMiddleware } from "hono/factory"
import { getCookie, deleteCookie } from "hono/cookie"
import { UserSession } from "../session/user-session"
import { Config } from "../../config/config"
import { parseDuration } from "../../util/duration"

type AuthEnv = {
  Variables: {
    session: UserSession.Info
    username: string
  }
}

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const config = await Config.get()

  // Skip if auth not enabled
  if (!config.auth?.enabled) {
    return next()
  }

  const sessionId = getCookie(c, "opencode_session")
  if (!sessionId) {
    return c.redirect("/login")
  }

  const session = UserSession.get(sessionId)
  if (!session) {
    deleteCookie(c, "opencode_session")
    return c.redirect("/login")
  }

  // Check idle timeout
  const timeout = parseDuration(config.auth.sessionTimeout ?? "7d") ?? 604800000
  if (Date.now() - session.lastAccessTime > timeout) {
    UserSession.remove(sessionId)
    deleteCookie(c, "opencode_session")
    return c.redirect("/login")
  }

  // Update last access time (sliding expiration)
  UserSession.touch(sessionId)

  c.set("session", session)
  c.set("username", session.username)
  await next()
})
```

### Pattern 3: Secure Cookie Configuration
**What:** Cookie options following security best practices
**When to use:** Setting session cookies
**Example:**
```typescript
// Source: https://hono.dev/docs/helpers/cookie
import { setCookie, deleteCookie } from "hono/cookie"

// Set session cookie with security attributes per CONTEXT.md decisions
function setSessionCookie(c: Context, sessionId: string) {
  const isSecure = c.req.url.startsWith("https://")

  setCookie(c, "opencode_session", sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "Strict",
    ...(isSecure && { secure: true }),
    // maxAge not set - session cookie (expires when browser closes)
    // For "remember me" feature (Phase 8), would add maxAge
  })
}

// Clear session cookie
function clearSessionCookie(c: Context) {
  deleteCookie(c, "opencode_session", {
    path: "/",
  })
}
```

### Pattern 4: Auth Routes with POST-only Logout
**What:** Routes following existing pattern with CSRF-safe logout
**When to use:** Authentication endpoints
**Example:**
```typescript
// Source: Follows server/routes/config.ts pattern
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { UserSession } from "../../session/user-session"
import { lazy } from "../../util/lazy"

export const AuthRoutes = lazy(() =>
  new Hono()
    // POST /auth/logout - Current session only
    .post(
      "/logout",
      describeRoute({
        summary: "Logout current session",
        operationId: "auth.logout",
        responses: {
          200: { description: "Logged out successfully" },
        },
      }),
      async (c) => {
        const sessionId = getCookie(c, "opencode_session")
        if (sessionId) {
          UserSession.remove(sessionId)
        }
        clearSessionCookie(c)
        return c.redirect("/login")
      },
    )
    // POST /auth/logout/all - All sessions for user
    .post(
      "/logout/all",
      describeRoute({
        summary: "Logout all sessions",
        operationId: "auth.logoutAll",
        responses: {
          200: { description: "All sessions logged out" },
        },
      }),
      async (c) => {
        const session = c.get("session")
        if (session) {
          UserSession.removeAllForUser(session.username)
        }
        clearSessionCookie(c)
        return c.redirect("/login")
      },
    )
)
```

### Anti-Patterns to Avoid
- **GET for logout:** Use POST only to prevent CSRF logout attacks via image tags
- **Storing sensitive data in cookies:** Only store session ID; user data stays server-side
- **Checking session only at login:** Validate on every authenticated request
- **Mixing AI sessions with user sessions:** Keep them separate (different namespaces)
- **Hardcoded timeout values:** Use config values parsed at runtime

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cookie parsing/setting | Manual header manipulation | hono/cookie helpers | Handles encoding, security attributes properly |
| Session ID generation | Math.random or timestamp | crypto.randomUUID() | Cryptographically secure, collision-resistant |
| Duration parsing | Regex/custom parser | ms package + Duration utility | Already in codebase, battle-tested |
| Middleware typing | Manual context casting | createMiddleware from hono/factory | Type-safe context access |
| CSRF for forms | Custom token system | SameSite=Strict cookie + POST-only | Browser handles most CSRF with strict cookies |

**Key insight:** Hono's cookie helpers handle all the edge cases (encoding, RFC compliance, security validation). The built-in CSRF middleware is available if needed, but SameSite=Strict cookies plus POST-only logout provides sufficient protection for this use case.

## Common Pitfalls

### Pitfall 1: Session Cookie Not Deleted on Invalid Session
**What goes wrong:** User sees "session expired" but cookie remains, causing redirect loops
**Why it happens:** Forget to delete cookie when session is invalid
**How to avoid:** Always call deleteCookie when session validation fails
**Warning signs:** Users stuck in redirect loops or seeing stale session data

### Pitfall 2: Timeout Calculated Against Creation Time Instead of Last Access
**What goes wrong:** Sessions expire based on when created, not when last used
**Why it happens:** Confusing "idle timeout" with "absolute timeout"
**How to avoid:** Update `lastAccessTime` on every authenticated request; compare against that
**Warning signs:** Active users getting logged out; timeout doesn't "reset" on activity

### Pitfall 3: Secure Cookie on HTTP Development
**What goes wrong:** Cookies not set in local development (http://localhost)
**Why it happens:** Setting `secure: true` unconditionally
**How to avoid:** Only set `secure: true` when URL starts with https://
**Warning signs:** Sessions work in production but not locally; cookie never appears

### Pitfall 4: Multiple Sessions Not Tracked Properly
**What goes wrong:** "Logout everywhere" misses some sessions
**Why it happens:** Not indexing sessions by username
**How to avoid:** Either maintain a secondary index or iterate all sessions
**Warning signs:** User logs out everywhere but other tabs still work

### Pitfall 5: Race Condition in Session Touch
**What goes wrong:** Concurrent requests cause inconsistent lastAccessTime
**Why it happens:** Read-modify-write without synchronization
**How to avoid:** For in-memory Map, JavaScript is single-threaded so direct assignment is safe
**Warning signs:** Not applicable to this implementation (Map operations are atomic)

### Pitfall 6: Cookie Path Mismatch on Delete
**What goes wrong:** deleteCookie doesn't actually delete the cookie
**Why it happens:** Must specify same path used when setting cookie
**How to avoid:** Always use `path: "/"` consistently for both set and delete
**Warning signs:** Cookie persists after logout; session somehow "survives"

## Code Examples

Verified patterns from official sources:

### Cookie Security Configuration
```typescript
// Source: https://hono.dev/docs/helpers/cookie
import { setCookie } from "hono/cookie"

// Full security configuration per CONTEXT.md decisions
setCookie(c, "opencode_session", sessionId, {
  path: "/",           // Root path (CONTEXT.md decision)
  httpOnly: true,      // Prevent JavaScript access (SESS-01)
  sameSite: "Strict",  // CSRF protection (SESS-01)
  secure: true,        // HTTPS only - omit for localhost (CONTEXT.md)
  // domain: not set   // Browser default - exact host (CONTEXT.md)
})
```

### Session Expiry Check with Sliding Window
```typescript
// Source: ms package + Config pattern
import ms from "ms"

function isSessionExpired(session: UserSession.Info, timeoutStr: string): boolean {
  const timeoutMs = ms(timeoutStr as ms.StringValue) ?? 604800000 // default 7d
  const elapsed = Date.now() - session.lastAccessTime
  return elapsed > timeoutMs
}

// On each request, update lastAccessTime if session is valid
function touchSession(session: UserSession.Info): void {
  session.lastAccessTime = Date.now()
}
```

### Integration with Existing Server Middleware Chain
```typescript
// Source: packages/opencode/src/server/server.ts pattern
// The existing server has middleware in this order:
// 1. onError handler
// 2. basicAuth (conditional on OPENCODE_SERVER_PASSWORD)
// 3. request logging
// 4. CORS

// Auth middleware should go AFTER CORS but BEFORE instance scoping:
app
  .use(cors({ ... }))
  .use(authMiddleware)  // NEW: Session validation
  .route("/global", GlobalRoutes())
  .use(async (c, next) => { /* Instance.provide */ })
  // ... rest of routes
```

### Logout Everywhere Implementation
```typescript
// Source: Pattern from CONTEXT.md requirements
export namespace UserSession {
  // Index for fast "logout everywhere" - optional optimization
  const sessionsByUser = new Map<string, Set<string>>()

  export function create(username: string, userAgent?: string): Info {
    const session = { /* ... */ }
    sessions.set(session.id, session)

    // Track sessions per user
    if (!sessionsByUser.has(username)) {
      sessionsByUser.set(username, new Set())
    }
    sessionsByUser.get(username)!.add(session.id)

    return session
  }

  export function removeAllForUser(username: string): number {
    const userSessions = sessionsByUser.get(username)
    if (!userSessions) return 0

    for (const sessionId of userSessions) {
      sessions.delete(sessionId)
    }
    const count = userSessions.size
    sessionsByUser.delete(username)
    return count
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JWT for sessions | Opaque session IDs with server storage | 2023+ trend | Simpler revocation, smaller cookies |
| SameSite=Lax default | SameSite=Strict for auth | 2024-2025 | Better CSRF protection |
| Custom CSRF tokens | SameSite cookies + POST-only | 2024+ | Less complexity, browser-native protection |
| express-session | Built-in cookie helpers | Hono ecosystem | No additional dependencies |

**Deprecated/outdated:**
- Cookie prefixes (`__Secure-`, `__Host-`) require HTTPS; useful but not required for localhost dev
- GET logout endpoints - browsers pre-fetch links, causing unexpected logouts

## Open Questions

Things that couldn't be fully resolved:

1. **Session cleanup interval**
   - What we know: Expired sessions accumulate in memory
   - What's unclear: Best interval for cleanup (hourly? daily?)
   - Recommendation: Add periodic cleanup (e.g., every hour) or cleanup on access

2. **Session limit per user**
   - What we know: CONTEXT.md says "no limit on concurrent sessions"
   - What's unclear: Memory implications with many sessions
   - Recommendation: Monitor in practice; add limit later if needed

3. **Redirect URL after login**
   - What we know: Logout redirects to /login per CONTEXT.md
   - What's unclear: Should login redirect to original URL or always to /?
   - Recommendation: Store original URL in query param (Phase 4 scope)

## Sources

### Primary (HIGH confidence)
- [Hono Cookie Helper](https://hono.dev/docs/helpers/cookie) - setCookie, getCookie, deleteCookie signatures and options
- [Hono Factory Helper](https://hono.dev/docs/helpers/factory) - createMiddleware for typed context
- [Hono CSRF Middleware](https://hono.dev/docs/middleware/builtin/csrf) - CSRF protection patterns
- [Bun UUID Documentation](https://bun.com/docs/guides/util/javascript-uuid) - crypto.randomUUID() usage
- packages/opencode/src/server/server.ts - Existing middleware patterns
- packages/opencode/src/config/auth.ts - AuthConfig schema from Phase 1
- packages/opencode/src/auth/index.ts - Existing Auth namespace pattern

### Secondary (MEDIUM confidence)
- [MDN Secure Cookie Configuration](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Cookies) - Cookie security attributes
- [Lucia Auth Hono Guide](https://v3.lucia-auth.com/guides/validate-session-cookies/hono) - Session cookie validation pattern

### Tertiary (LOW confidence)
- WebSearch results on session timeout patterns - Verified against MDN and Hono docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in codebase or built-in to Hono
- Architecture: HIGH - patterns directly match existing codebase conventions
- Pitfalls: HIGH - verified against official documentation
- Session expiry logic: HIGH - straightforward timestamp comparison

**Research date:** 2026-01-20
**Valid until:** 60 days (stable technology, Hono API unlikely to change)
