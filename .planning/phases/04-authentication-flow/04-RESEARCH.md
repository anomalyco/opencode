# Phase 4: Authentication Flow - Research

**Researched:** 2026-01-20
**Domain:** HTTP login endpoint, session creation, user info lookup
**Confidence:** HIGH

## Summary

Phase 4 implements the login endpoint (`POST /auth/login`) that validates credentials via the auth broker (from Phase 3) and creates user sessions (from Phase 2). The implementation extends existing patterns in the codebase.

Research confirms:
1. **BrokerClient exists and is tested** - Located at `src/auth/broker-client.ts`, provides `authenticate(username, password)` returning `{success, error?}`
2. **UserSession infrastructure exists** - Located at `src/session/user-session.ts`, provides `create(username, userAgent?)` returning session with id, username, createdAt, lastAccessTime
3. **Route patterns are established** - Hono routes with `describeRoute`, `validator`, `resolver` from hono-openapi
4. **AuthRoutes already has /logout and /session** - Login endpoint fits naturally alongside existing routes
5. **User info (UID, GID, home, shell) NOT in broker** - Broker only returns success/failure; TypeScript side needs to look up user info

**Primary recommendation:** Add login endpoint to existing `AuthRoutes`, use `BrokerClient.authenticate()` for validation, extend `UserSession` schema to include UNIX user info, use `getent passwd <username>` to look up user details after successful auth.

## Standard Stack

The established libraries/tools for this domain:

### Core (Already in Codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | catalog | HTTP framework | Already used for all routes |
| hono-openapi | catalog | OpenAPI decorators | Already used for describeRoute, validator, resolver |
| zod | catalog | Schema validation | Already used for all schemas |
| BrokerClient | (local) | PAM authentication | Built in Phase 3, tested |
| UserSession | (local) | Session storage | Built in Phase 2, tested |

### Supporting (Already in Codebase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| hono/cookie | (bundled) | Cookie management | getCookie, setCookie, deleteCookie |
| @opencode-ai/util/error | workspace | Named errors | Error response formatting |

### New Requirements
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | User info lookup | Use Bun shell to call `getent passwd` |

**No new dependencies required.** All functionality can be built with existing libraries plus shell commands.

## Architecture Patterns

### Recommended Project Structure (Modifications)
```
packages/opencode/src/
├── auth/
│   ├── index.ts              # (existing) Re-exports broker client
│   ├── broker-client.ts      # (existing) PAM authentication
│   └── user-info.ts          # (NEW) UID/GID/home/shell lookup
├── session/
│   └── user-session.ts       # (MODIFY) Add user info fields to schema
├── server/
│   ├── middleware/
│   │   └── auth.ts           # (existing) Session validation middleware
│   └── routes/
│       └── auth.ts           # (MODIFY) Add POST /login, GET /status
```

### Pattern 1: Login Endpoint Flow
**What:** POST /auth/login validates credentials and creates session
**When to use:** User login requests
**Why:** Separates concerns - broker validates, TypeScript creates session

```typescript
// Source: Existing route patterns in src/server/routes/*.ts
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { BrokerClient } from "../../auth/broker-client"
import { UserSession } from "../../session/user-session"
import { setSessionCookie } from "../middleware/auth"
import { getUserInfo } from "../../auth/user-info"

const loginSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1),
  returnUrl: z.string().optional(),
})

app.post(
  "/login",
  describeRoute({
    summary: "Login with username and password",
    operationId: "auth.login",
    // ...
  }),
  validator("json", loginSchema),
  async (c) => {
    // 1. Check X-Requested-With header for basic CSRF protection
    const xrw = c.req.header("X-Requested-With")
    if (!xrw) {
      return c.json({ error: "csrf_missing", message: "X-Requested-With header required" }, 400)
    }

    const { username, password, returnUrl } = c.req.valid("json")

    // 2. Validate returnUrl (same-origin only)
    if (returnUrl && !isValidReturnUrl(returnUrl)) {
      return c.json({ error: "invalid_return_url", message: "Invalid return URL" }, 400)
    }

    // 3. Authenticate via broker
    const broker = new BrokerClient()
    const result = await broker.authenticate(username, password)

    if (!result.success) {
      return c.json({ error: "auth_failed", message: "Authentication failed" }, 401)
    }

    // 4. Look up user info (UID, GID, home, shell)
    const userInfo = await getUserInfo(username)
    if (!userInfo) {
      // User authenticated but not found in passwd - shouldn't happen
      return c.json({ error: "auth_failed", message: "Authentication failed" }, 401)
    }

    // 5. Create session with full user info
    const session = UserSession.create(username, c.req.header("User-Agent"), userInfo)

    // 6. Set session cookie
    setSessionCookie(c, session.id)

    // 7. Return success with user info
    return c.json({
      success: true,
      user: {
        username: session.username,
        uid: session.uid,
        gid: session.gid,
        home: session.home,
        shell: session.shell,
      },
    })
  },
)
```

### Pattern 2: User Info Lookup via getent
**What:** Look up UNIX user info by username using system command
**When to use:** After successful broker authentication
**Why:** No native Node.js API; getent works with PAM/NSS (LDAP/Kerberos transparent)

```typescript
// Source: POSIX getent(1), Bun shell documentation
import { $ } from "bun"

export interface UnixUserInfo {
  username: string
  uid: number
  gid: number
  gecos: string
  home: string
  shell: string
}

export async function getUserInfo(username: string): Promise<UnixUserInfo | null> {
  try {
    // getent passwd <username> returns: username:x:uid:gid:gecos:home:shell
    const result = await $`getent passwd ${username}`.quiet().text()
    const line = result.trim()
    if (!line) return null

    const parts = line.split(":")
    if (parts.length < 7) return null

    return {
      username: parts[0],
      uid: parseInt(parts[2], 10),
      gid: parseInt(parts[3], 10),
      gecos: parts[4],
      home: parts[5],
      shell: parts[6],
    }
  } catch {
    return null
  }
}
```

### Pattern 3: Extended UserSession Schema
**What:** Add UNIX user fields to UserSession.Info
**When to use:** Always - sessions now include full user info
**Why:** Phase 5 needs UID/GID for process execution

```typescript
// Source: Extending existing src/session/user-session.ts
export const Info = z
  .object({
    id: z.string(),
    username: z.string(),
    uid: z.number().optional(),     // UNIX user ID
    gid: z.number().optional(),     // UNIX primary group ID
    home: z.string().optional(),    // Home directory
    shell: z.string().optional(),   // Login shell
    createdAt: z.number(),
    lastAccessTime: z.number(),
    userAgent: z.string().optional(),
  })
  .meta({ ref: "UserSessionInfo" })
```

### Pattern 4: returnUrl Validation
**What:** Validate post-login redirect URL is same-origin
**When to use:** When returnUrl parameter is provided
**Why:** Prevent open redirect attacks

```typescript
// Source: OWASP Unvalidated Redirects guidance
function isValidReturnUrl(url: string): boolean {
  // Must start with / (relative path)
  if (!url.startsWith("/")) return false

  // Must not have protocol or double slashes (prevent //evil.com)
  if (url.startsWith("//")) return false

  // Must not contain newlines (header injection)
  if (url.includes("\n") || url.includes("\r")) return false

  return true
}
```

### Pattern 5: Content-Type Detection
**What:** Accept both JSON and form POST
**When to use:** Login endpoint
**Why:** CONTEXT.md decision - support both for flexibility

```typescript
// Source: Hono middleware patterns
async function parseLoginBody(c: Context): Promise<{ username: string; password: string; returnUrl?: string } | null> {
  const contentType = c.req.header("Content-Type") ?? ""

  if (contentType.includes("application/json")) {
    return c.req.json()
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await c.req.parseBody()
    return {
      username: String(form.username ?? ""),
      password: String(form.password ?? ""),
      returnUrl: form.returnUrl ? String(form.returnUrl) : undefined,
    }
  }

  return null
}
```

### Anti-Patterns to Avoid
- **Detailed error messages:** Return generic "Authentication failed" for all auth errors
- **Logging passwords:** Never log the password, even in debug mode
- **Different timing for user-not-found vs wrong-password:** Same code path for both (broker handles this)
- **Absolute URLs in returnUrl:** Only allow relative paths starting with /
- **Skipping X-Requested-With check:** Required for basic CSRF protection until Phase 7

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| User info lookup | Parse /etc/passwd manually | `getent passwd` command | Works with LDAP/Kerberos via NSS |
| Session creation | Custom Map management | Existing UserSession namespace | Already tested, has user-based indexing |
| Cookie security | Manual Set-Cookie header | hono/cookie setCookie | Handles all security attributes |
| CSRF protection | Custom token system | X-Requested-With header check | Sufficient for Phase 4; full CSRF in Phase 7 |

**Key insight:** The codebase already has most infrastructure. Phase 4 connects existing pieces with minimal new code.

## Common Pitfalls

### Pitfall 1: Leaking Auth Failure Details
**What goes wrong:** Different error messages for "user not found" vs "wrong password"
**Why it happens:** Natural to return broker error details
**How to avoid:** Always return generic `{"error": "auth_failed", "message": "Authentication failed"}` regardless of failure reason
**Warning signs:** Different HTTP status codes or error messages for different failure types

### Pitfall 2: Open Redirect via returnUrl
**What goes wrong:** Attacker crafts link with returnUrl=//evil.com
**Why it happens:** Insufficient URL validation
**How to avoid:** Only allow relative paths starting with `/`, reject `//`, reject newlines
**Warning signs:** returnUrl can be any URL, not just paths

### Pitfall 3: Session Created Before Auth Succeeds
**What goes wrong:** Session exists even if auth fails, leaking timing info
**Why it happens:** Creating session before checking broker result
**How to avoid:** Check broker result first, only then create session
**Warning signs:** Session created in try block before auth check

### Pitfall 4: getent Failure Treated as Auth Failure
**What goes wrong:** System command fails but user is valid
**Why it happens:** Conflating "user doesn't exist" with "getent failed"
**How to avoid:** Log getent failures separately; consider fallback to `id` command
**Warning signs:** Valid users intermittently fail to log in

### Pitfall 5: Missing Content-Type Handling
**What goes wrong:** Form POSTs fail with 400 Bad Request
**Why it happens:** Only handling application/json
**How to avoid:** Check Content-Type and parse appropriately
**Warning signs:** Login works from curl with -H but not from HTML form

## Code Examples

Verified patterns from existing codebase:

### Route Registration Pattern
```typescript
// Source: src/server/routes/auth.ts (existing pattern)
export const AuthRoutes = lazy(() =>
  new Hono<AuthEnv>()
    .post(
      "/login",
      describeRoute({
        summary: "Login with username and password",
        description: "Authenticate user and create session.",
        operationId: "auth.login",
        responses: {
          200: {
            description: "Login successful",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.literal(true),
                    user: z.object({
                      username: z.string(),
                      uid: z.number(),
                      gid: z.number(),
                      home: z.string(),
                      shell: z.string(),
                    }),
                  }),
                ),
              },
            },
          },
          400: { description: "Bad request" },
          401: { description: "Authentication failed" },
        },
      }),
      // ... handler
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get auth status",
        description: "Check if authentication is enabled.",
        operationId: "auth.status",
        responses: {
          200: {
            description: "Auth status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    enabled: z.boolean(),
                    method: z.string().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        return c.json({
          enabled: config.auth?.enabled ?? false,
          method: config.auth?.enabled ? (config.auth?.method ?? "pam") : undefined,
        })
      },
    )
    // ... existing /logout, /logout/all, /session
)
```

### Error Response Pattern
```typescript
// Source: src/server/error.ts, NamedError patterns
// Match existing error format
return c.json(
  {
    error: "auth_failed",
    message: "Authentication failed",
  },
  401,
)
```

### Session Cookie Pattern
```typescript
// Source: src/server/middleware/auth.ts (existing)
import { setSessionCookie } from "../middleware/auth"

// After successful auth:
const session = UserSession.create(username, userAgent, userInfo)
setSessionCookie(c, session.id)
```

## Integration Points

### Files to Modify

1. **`src/session/user-session.ts`**
   - Extend `Info` schema with `uid`, `gid`, `home`, `shell`
   - Update `create()` to accept optional `UnixUserInfo`

2. **`src/server/routes/auth.ts`**
   - Add `POST /login` endpoint
   - Add `GET /status` endpoint
   - Keep existing `/logout`, `/logout/all`, `/session` endpoints

3. **`src/server/middleware/auth.ts`**
   - Update middleware to capture `returnUrl` from original request
   - Store in session or pass via redirect query parameter

### New Files to Create

1. **`src/auth/user-info.ts`**
   - `getUserInfo(username: string): Promise<UnixUserInfo | null>`
   - Uses `getent passwd` command

### No Changes Required

- `src/auth/broker-client.ts` - Already provides `authenticate()`
- `src/server/server.ts` - AuthRoutes already registered at `/auth`
- `src/config/auth.ts` - Already has AuthConfig schema

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Native userid/pwuid npm packages | Shell out to getent | Current | No native deps, works with NSS/LDAP |
| Separate AuthenticatedSession type | Extend UserSession with optional fields | Design decision | Simpler, backwards compatible |
| Custom CSRF tokens | X-Requested-With header | Phase 4 decision | Sufficient for XHR; full CSRF in Phase 7 |

**Deprecated/outdated:**
- **Native getpwnam bindings:** Complex to build, not worth the complexity for this use case
- **Parsing /etc/passwd directly:** Doesn't work with LDAP/Kerberos/NIS

## Open Questions

Things that couldn't be fully resolved:

1. **Supplementary groups**
   - What we know: Primary GID from getent passwd is straightforward
   - What's unclear: Whether Phase 5 needs all groups (getent group, id -G)
   - Recommendation: Start with primary GID only; add groups if Phase 5 needs them

2. **macOS getent availability**
   - What we know: macOS has `dscl` instead of `getent`
   - What's unclear: Whether `id -P` or `dscl` is better approach
   - Recommendation: Test on macOS; may need platform-specific lookup

3. **Rate limiting at HTTP layer**
   - What we know: Broker has rate limiting; HTTP layer could add more
   - What's unclear: Whether Phase 7 rate limiting covers login or needs Phase 4 work
   - Recommendation: Defer to Phase 7; broker rate limiting is sufficient for now

## Sources

### Primary (HIGH confidence)
- `src/auth/broker-client.ts` - BrokerClient implementation
- `src/session/user-session.ts` - UserSession implementation
- `src/server/routes/auth.ts` - Existing AuthRoutes
- `src/server/middleware/auth.ts` - setSessionCookie, clearSessionCookie
- `src/config/auth.ts` - AuthConfig schema
- [getent(1) man page](https://man7.org/linux/man-pages/man1/getent.1.html) - passwd database lookup

### Secondary (MEDIUM confidence)
- [Bun shell documentation](https://bun.com/docs/runtime/shell) - $ template literal
- [OWASP Unvalidated Redirects](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html) - returnUrl validation
- [node-userid npm](https://github.com/cinderblock/node-userid) - Alternative approach (not used)

### Tertiary (LOW confidence)
- macOS dscl approach - Needs testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in codebase
- Architecture: HIGH - Extends existing patterns directly
- Integration points: HIGH - Analyzed actual source files
- User info lookup: MEDIUM - getent works on Linux; macOS needs testing
- Error handling: HIGH - Follows existing patterns

**Research date:** 2026-01-20
**Valid until:** 2026-02-20 (30 days - stable domain)

---

*Phase: 04-authentication-flow*
*Research complete: 2026-01-20*
