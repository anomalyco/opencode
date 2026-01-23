# Phase 8: Session Enhancements - Research

**Researched:** 2026-01-23
**Domain:** Session management, cookie-based authentication, activity-based refresh, UX patterns
**Confidence:** HIGH

## Summary

This phase enhances the existing Hono + cookie-based session system with "remember me" functionality, session activity indicators, and automatic session refresh. The codebase already has the necessary infrastructure: Hono's cookie helpers, SolidJS with @kobalte/core for UI components (Toast and Dialog), and the `ms` library for duration parsing.

The standard approach for "remember me" is to set a longer `maxAge` on the session cookie (30 days vs. the default 7 days). Session activity should refresh silently by piggybacking on existing API requests rather than creating a dedicated refresh endpoint. Expiration warnings should use toast notifications (non-blocking) 15 minutes before timeout, with a modal overlay if the session expires while the user is active.

**Primary recommendation:** Use Hono's `setCookie` with conditional `maxAge` based on "remember me" checkbox, implement activity-based refresh via middleware that updates `lastAccessTime` on every authenticated request, and use existing @kobalte Toast/Dialog components for warnings and expiration overlays.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono cookie helpers | 4.10.7 | Session cookie management | Already in use; supports maxAge, secure, httpOnly, sameSite |
| @kobalte/core | 0.13.11 | Toast and Dialog components | Already in use; accessible, SolidJS-native |
| ms | 2.1.3 | Duration parsing | Already in use; tiny, well-maintained by Vercel |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| SolidJS signals | 1.9.10 | Reactive session state tracking | Frontend session timer/countdown |
| Hono middleware | 4.10.7 | Activity detection via request interception | Silent session refresh on API calls |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @kobalte Toast | solid-toast | solid-toast is simpler but @kobalte already in project |
| Activity piggybacking | Dedicated /refresh endpoint | Dedicated endpoint adds extra requests; piggybacking is invisible |
| Cookie maxAge | localStorage expiry | Cookies are HttpOnly (more secure); localStorage vulnerable to XSS |

**Installation:**
No new dependencies required. All necessary libraries already installed.

## Architecture Patterns

### Recommended Project Structure
```
packages/opencode/src/
├── server/
│   ├── middleware/
│   │   └── auth.ts                    # Extend with remember-me logic
│   └── routes/
│       └── auth.ts                    # Add remember-me checkbox handling
packages/app/src/
├── components/
│   └── session-status-indicator.tsx   # Username dropdown with logout
├── context/
│   └── session-monitor.tsx            # Activity tracking & expiration warnings
```

### Pattern 1: Persistent Cookie via maxAge
**What:** Session cookies without `maxAge` delete on browser close. Setting `maxAge` creates a persistent cookie.
**When to use:** When "remember me" checkbox is checked.
**Example:**
```typescript
// Source: https://hono.dev/docs/helpers/cookie
import { setCookie } from "hono/cookie"

// Session cookie (deleted on browser close)
setCookie(c, "opencode_session", sessionId, {
  path: "/",
  httpOnly: true,
  sameSite: "Strict",
  secure: isHttps,
  // No maxAge or expires = session cookie
})

// Persistent cookie (survives browser restart)
const rememberMeDuration = parseDuration("30d") // 30 days in ms
setCookie(c, "opencode_session", sessionId, {
  path: "/",
  httpOnly: true,
  sameSite: "Strict",
  secure: isHttps,
  maxAge: rememberMeDuration / 1000, // maxAge is in SECONDS, not ms
})
```
**CRITICAL:** Hono's `maxAge` option is in **seconds**, not milliseconds. Divide `parseDuration()` result by 1000.

### Pattern 2: Activity-Based Session Refresh
**What:** Update `lastAccessTime` on every authenticated request to extend idle timeout.
**When to use:** For all authenticated API calls (already implemented in existing auth middleware).
**Example:**
```typescript
// Source: Current codebase pattern
// packages/opencode/src/server/middleware/auth.ts lines 123-124

// Update lastAccessTime (sliding expiration)
UserSession.touch(sessionId)
```
**Current implementation:** Middleware already calls `UserSession.touch(sessionId)` on every request. This is the "piggyback" pattern - no changes needed for basic activity refresh.

### Pattern 3: Frontend Session Monitoring
**What:** Track time until expiration and show warnings in the UI.
**When to use:** When user is actively viewing the page.
**Example:**
```typescript
// Pattern: Poll /auth/session endpoint to get lastAccessTime
// Calculate remaining time = (lastAccessTime + timeout) - Date.now()
// Show toast when remainingTime < 15 minutes

import { createSignal, onCleanup } from "solid-js"
import { showToast } from "@opencode-ai/ui/components/toast"

function SessionMonitor() {
  const [remainingMs, setRemainingMs] = createSignal<number | null>(null)

  // Poll session status every 60 seconds
  const interval = setInterval(async () => {
    const res = await fetch("/auth/session")
    if (res.ok) {
      const session = await res.json()
      const timeout = parseDuration("7d") // Or get from config
      const remaining = (session.lastAccessTime + timeout) - Date.now()
      setRemainingMs(remaining)

      // Warn 15 minutes before expiry
      if (remaining < 15 * 60 * 1000 && remaining > 0) {
        showWarningToast()
      }
    }
  }, 60000)

  onCleanup(() => clearInterval(interval))
}
```
**Throttle recommendation:** Poll every 60 seconds. Less frequent polling (2-5 minutes) acceptable for low-risk applications.

### Pattern 4: Session Expiration Warning Toast
**What:** Non-blocking notification 15 minutes before session expires.
**When to use:** When countdown reaches warning threshold.
**Example:**
```typescript
// Source: Existing @kobalte toast pattern
import { showToast } from "@opencode-ai/ui/components/toast"

function showSessionWarningToast() {
  showToast({
    title: "Session expiring soon",
    description: "Your session will expire in 15 minutes",
    variant: "default",
    icon: "clock", // Or appropriate icon
    persistent: true, // Don't auto-dismiss
    actions: [
      {
        label: "Extend session",
        onClick: async () => {
          // Trigger activity by calling any authenticated endpoint
          await fetch("/auth/session") // This refreshes lastAccessTime
        }
      }
    ]
  })
}
```

### Pattern 5: Session Expired Overlay
**What:** Modal overlay when session expires while user is active on the page.
**When to use:** When poll detects session no longer exists or expired.
**Example:**
```typescript
// Source: @kobalte Dialog pattern
import { Dialog } from "@kobalte/core/dialog"
import { createSignal } from "solid-js"

function SessionExpiredOverlay() {
  const [open, setOpen] = createSignal(false)

  // Triggered when session poll returns 401
  function showExpiredOverlay() {
    setOpen(true)
  }

  return (
    <Dialog.Root open={open()}>
      <Dialog.Portal>
        <Dialog.Overlay data-slot="dialog-overlay" />
        <Dialog.Content>
          <Dialog.Title>Session Expired</Dialog.Title>
          <Dialog.Description>
            Your session has expired. Please log in again to continue.
          </Dialog.Description>
          <button onClick={() => window.location.href = "/auth/login"}>
            Log In
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```
**Context preservation:** Overlay appears over current page, user can see their work before being redirected.

### Anti-Patterns to Avoid
- **Countdown in UI:** Showing exact seconds/minutes remaining is confusing and creates anxiety. Show warning only when close to expiry.
- **Dedicated refresh endpoint:** Creates extra HTTP traffic. Piggyback on existing authenticated requests instead.
- **Client-side timeout calculation only:** Must validate server-side. Client clock may be wrong or manipulated.
- **Remember me without duration limit:** Always cap at 30-400 days per security best practices.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cookie max-age calculation | Manual date math | Hono `maxAge` with `ms()` | Hono enforces 400-day RFC6265bis limit, handles edge cases |
| Toast notifications | Custom positioned divs | @kobalte Toast (already installed) | Handles stacking, animations, accessibility, screen readers |
| Modal overlays | z-index + backdrop | @kobalte Dialog (already installed) | Manages focus trapping, scroll blocking, ESC key, ARIA |
| Duration parsing | String splitting/regex | `ms` library (already installed) | Handles "30d", "7 days", "1h" formats consistently |
| Activity detection | Manual event listeners | Middleware-based touch on API calls | Captures all activity (not just clicks), no frontend overhead |

**Key insight:** The codebase already has all necessary primitives. Session enhancements are about **composing existing tools**, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: maxAge Units Confusion
**What goes wrong:** Setting `maxAge: parseDuration("30d")` results in ~2.6 billion second expiry (83 years instead of 30 days).
**Why it happens:** Hono's `maxAge` is in **seconds**, but `parseDuration()` returns **milliseconds**.
**How to avoid:** Always divide by 1000: `maxAge: parseDuration("30d") / 1000`
**Warning signs:** Cookie inspector shows expiry date decades in the future.

### Pitfall 2: Remember Me Cookie Without Server Timeout Change
**What goes wrong:** Cookie persists 30 days but server expires session after 7 days idle. User returns day 10, cookie exists but session is gone.
**Why it happens:** Cookie expiry and session idle timeout are separate concerns.
**How to avoid:** When "remember me" is checked, use longer server-side timeout too (same duration as cookie maxAge).
**Warning signs:** Users report "remember me doesn't work" after returning from multi-day break.

### Pitfall 3: Polling During Inactivity
**What goes wrong:** Session monitor polls every 60s even when user switched tabs, wasting resources and preventing idle timeout.
**Why it happens:** `setInterval` runs regardless of page visibility.
**How to avoid:** Use Page Visibility API or pause polling when document.hidden is true.
**Warning signs:** Backend logs show session refreshes from "idle" users; sessions never actually time out.

### Pitfall 4: Session Warning After Expiry
**What goes wrong:** Warning toast appears but session already expired, "Extend" button fails.
**Why it happens:** Poll interval (60s) is longer than warning window (900s), so detection lags.
**How to avoid:** Either poll more frequently as expiry approaches, or show warning with sufficient buffer (15 min before + 60s poll = 16 min warning threshold).
**Warning signs:** Users click "Extend session" button and get "session expired" error.

### Pitfall 5: Logout Invalidates Cookie But Not Session
**What goes wrong:** User clicks logout, cookie is deleted, but session persists in server memory. If attacker steals old session ID, it still works.
**Why it happens:** Logout handler calls `clearSessionCookie()` but not `UserSession.remove()`.
**How to avoid:** Always clear both cookie AND server-side session on logout.
**Warning signs:** Old session IDs still valid after logout (security vulnerability).

### Pitfall 6: Missing Secure Flag on Non-Localhost
**What goes wrong:** Session cookies sent over HTTP in production, vulnerable to interception.
**Why it happens:** Conditional `secure: isHttps` doesn't account for reverse proxy headers.
**How to avoid:** Check `X-Forwarded-Proto` header when behind proxy; require HTTPS in production.
**Warning signs:** Browser console warnings about insecure cookies; security audit failures.

## Code Examples

Verified patterns from official sources:

### Session Cookie with Conditional Persistence
```typescript
// Source: Hono cookie docs + current codebase pattern
import { setCookie } from "hono/cookie"
import { parseDuration } from "../../util/duration"

function setSessionCookie(c: Context, sessionId: string, rememberMe: boolean): void {
  const isHttps = c.req.url.startsWith("https://")
  const baseOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "Strict" as const,
    secure: isHttps,
  }

  if (rememberMe) {
    // Persistent cookie (30 days)
    const maxAgeMs = parseDuration("30d")!
    setCookie(c, "opencode_session", sessionId, {
      ...baseOptions,
      maxAge: maxAgeMs / 1000, // Convert ms to seconds
    })
  } else {
    // Session cookie (deleted on browser close)
    setCookie(c, "opencode_session", sessionId, baseOptions)
  }
}
```

### Login Handler with Remember Me Checkbox
```typescript
// Source: Current /auth/login pattern, extended
const loginRequestSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
})

app.post("/auth/login", async (c) => {
  const { username, password, rememberMe } = await c.req.json()

  // ... authentication logic ...

  const session = UserSession.create(username, c.req.header("User-Agent"), userInfo)
  setSessionCookie(c, session.id, rememberMe ?? false)

  return c.json({ success: true, user: { username } })
})
```

### Session Status Check Endpoint
```typescript
// Source: Current /auth/session endpoint (already exists!)
// packages/opencode/src/server/routes/auth.ts lines 756-803
app.get("/auth/session", async (c) => {
  const sessionId = getCookie(c, "opencode_session")
  if (!sessionId) {
    return c.json({ error: "Not authenticated" }, 401)
  }
  const session = UserSession.get(sessionId)
  if (!session) {
    return c.json({ error: "Not authenticated" }, 401)
  }
  return c.json({
    id: session.id,
    username: session.username,
    createdAt: session.createdAt,
    lastAccessTime: session.lastAccessTime, // Frontend needs this for countdown
    uid: session.uid,
    gid: session.gid,
  })
})
```
**Note:** This endpoint already exists! Just use it for polling session status.

### Frontend Session Expiration Monitor
```typescript
// Source: SolidJS reactive patterns + OWASP session timeout guidance
import { createSignal, createEffect, onCleanup } from "solid-js"
import { showToast, toaster } from "@opencode-ai/ui/components/toast"

const WARNING_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes
const POLL_INTERVAL_MS = 60 * 1000 // 1 minute

export function useSessionMonitor() {
  const [sessionExpired, setSessionExpired] = createSignal(false)
  let warningToastId: number | undefined

  async function checkSession() {
    try {
      const res = await fetch("/auth/session")
      if (!res.ok) {
        // Session invalid/expired
        setSessionExpired(true)
        return
      }

      const session = await res.json()
      const timeoutMs = parseDuration("7d")! // Get from config
      const remainingMs = (session.lastAccessTime + timeoutMs) - Date.now()

      if (remainingMs < 0) {
        setSessionExpired(true)
      } else if (remainingMs < WARNING_THRESHOLD_MS) {
        // Show warning if not already shown
        if (!warningToastId) {
          warningToastId = showToast({
            title: "Session expiring soon",
            description: "Your session will expire in 15 minutes",
            persistent: true,
            actions: [
              {
                label: "Extend session",
                onClick: async () => {
                  await fetch("/auth/session") // Refreshes lastAccessTime
                  warningToastId = undefined
                }
              }
            ]
          })
        }
      }
    } catch (err) {
      console.error("Session check failed:", err)
    }
  }

  // Poll session status
  const interval = setInterval(checkSession, POLL_INTERVAL_MS)
  checkSession() // Initial check

  onCleanup(() => {
    clearInterval(interval)
    if (warningToastId) {
      toaster.dismiss(warningToastId)
    }
  })

  return { sessionExpired }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Expires attribute | Max-Age attribute | RFC6265bis (2021) | Max-Age has precedence; simpler relative expiry |
| 1-year+ "remember me" | 30-400 day limit | Chrome 104 (2022) | Browsers cap cookie age at 400 days |
| Client-side timers only | Hybrid client/server validation | OWASP 2024 | Prevents client clock manipulation attacks |
| Dedicated refresh tokens | Activity-based sliding window | OAuth 2.1 draft | Simpler for session-based auth; tokens for stateless |
| Alert() for session expiry | Toast/modal patterns | Modern UX (2020+) | Non-blocking, accessible, better UX |

**Deprecated/outdated:**
- **Expires-only cookies:** Max-Age is now standard and has precedence when both are set
- **localStorage for session tokens:** Vulnerable to XSS; HttpOnly cookies are the secure standard
- **Aggressive countdown timers:** Creates anxiety; modern UX shows warning only near expiry

## Open Questions

Things that couldn't be fully resolved:

1. **Should "remember me" duration be configurable per-user?**
   - What we know: Configuration exists for global `sessionTimeout` in opencode.json
   - What's unclear: Whether different users need different durations (e.g., admin vs. regular user)
   - Recommendation: Start with single global `rememberMeTimeout` config. Add per-user logic only if use case emerges.

2. **Should session refresh trigger on non-mutating requests (GET)?**
   - What we know: Current middleware refreshes on ALL authenticated requests
   - What's unclear: Whether GETs should extend session or only POSTs/PUTs (activity vs. just viewing)
   - Recommendation: Refresh on all requests (current behavior). Viewing pages counts as activity. Document this in README.

3. **How to handle session expiry during active form editing?**
   - What we know: Modal overlay shows expired state
   - What's unclear: Should we preserve unsaved form data in localStorage for recovery?
   - Recommendation: Phase 8 shows basic overlay. Data preservation is a future enhancement (out of scope).

## Sources

### Primary (HIGH confidence)
- [Hono Cookie Helper Documentation](https://hono.dev/docs/helpers/cookie) - setCookie options, maxAge specification
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) - Timeout durations, idle vs. absolute timeouts, security practices
- [Kobalte Dialog Documentation](https://kobalte.dev/docs/core/components/dialog/) - Modal overlay patterns, accessibility
- Current codebase: packages/opencode/src/server/middleware/auth.ts - Existing session management patterns
- Current codebase: packages/ui/src/components/toast.tsx - Existing toast implementation

### Secondary (MEDIUM confidence)
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) - Max-Age vs. Expires, cookie attributes
- [Chrome Cookie Max-Age Cap](https://developer.chrome.com/blog/cookie-max-age-expires) - 400-day browser limit
- [Auth0: Application Session Management Best Practices](https://auth0.com/blog/application-session-management-best-practices/) - Activity detection, silent refresh patterns
- [UK Government Design System: Session Timeout](https://design-system.dwp.gov.uk/patterns/manage-a-session-timeout) - UX patterns for warnings, countdown timers
- [PatternFly: Session Timeout](https://pf3.patternfly.org/v3/pattern-library/communication/session-timeout/) - Modal timing, accessibility

### Tertiary (LOW confidence)
- WebSearch findings on remember me durations (7 vs. 30 days) - Community practices, no single standard
- WebSearch findings on session-based vs. token-based auth - General context, not specific to this implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in use, versions confirmed in package.json
- Architecture: HIGH - Patterns verified in existing codebase and official docs
- Pitfalls: HIGH - Based on official RFCs (RFC6265bis), browser behavior (Chrome caps), and OWASP guidelines
- Code examples: HIGH - Derived from current codebase patterns + official Hono/Kobalte docs
- UX patterns: MEDIUM - Design system recommendations (gov.uk, PatternFly) but no user testing for this specific app

**Research date:** 2026-01-23
**Valid until:** 2026-02-23 (30 days - stable domain, mature libraries)
