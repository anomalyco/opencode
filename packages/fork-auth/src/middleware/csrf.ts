import { createMiddleware } from "hono/factory"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import type { Context } from "hono"
import {
  generateCSRFToken,
  validateCSRFToken,
  getCSRFSecret,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../security/csrf"
import { ServerAuth } from "../server-auth"
import { Log } from "../../../opencode/src/util/log"

const log = Log.create({ service: "csrf-middleware" })

/**
 * Set CSRF cookie with a new token bound to the session.
 *
 * Call this after successful login or when regenerating CSRF token.
 *
 * @param c - Hono context
 * @param sessionId - Current session ID to bind token to
 */
export function setCSRFCookie(c: Context, sessionId: string): void {
  const secret = getCSRFSecret()
  const token = generateCSRFToken(sessionId, secret)

  const isHttps = c.req.url.startsWith("https://")

  setCookie(c, CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Required for double-submit pattern - client needs to read it
    secure: isHttps,
    sameSite: "Lax",
    path: "/",
  })
}

/**
 * Clear CSRF cookie.
 *
 * Call this during logout to remove CSRF token.
 *
 * @param c - Hono context
 */
export function clearCSRFCookie(c: Context): void {
  deleteCookie(c, CSRF_COOKIE_NAME, { path: "/" })
}

/**
 * CSRF protection middleware using HMAC-signed double-submit cookie pattern.
 *
 * Validates CSRF tokens on state-changing requests (POST, PUT, DELETE, PATCH).
 * Safe methods (GET, HEAD, OPTIONS) are allowed through without validation.
 *
 * When auth is disabled, CSRF protection is skipped (no session to bind to).
 *
 * Allowlist:
 * - /auth/login - Login endpoint sets the CSRF cookie
 * - /auth/status - Read-only status check
 * - Custom routes from auth config (csrfAllowlist)
 */
export const csrfMiddleware = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase()

  // Skip CSRF validation for safe methods (idempotent, read-only)
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next()
  }

  const authConfig = ServerAuth.get()

  // Skip CSRF when auth is disabled (no session binding)
  if (!authConfig.enabled) {
    return next()
  }

  const path = c.req.path

  // Default allowlist: login sets cookie, status is read-only, login/2fa is mid-login flow
  const defaultAllowlist = ["/auth/login", "/auth/login/2fa", "/auth/status"]
  const customAllowlist = authConfig.csrfAllowlist ?? []
  const allowlist = [...defaultAllowlist, ...customAllowlist]

  // Skip CSRF for allowlisted routes
  if (allowlist.includes(path)) {
    return next()
  }

  // Get token from header or body
  let requestToken = c.req.header(CSRF_HEADER_NAME)

  // Fallback to body._csrf field if header not present
  if (!requestToken) {
    try {
      const contentType = c.req.header("Content-Type") ?? ""
      if (contentType.includes("application/json")) {
        const body = await c.req.json()
        requestToken = body._csrf
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const body = await c.req.parseBody()
        requestToken = body._csrf ? String(body._csrf) : undefined
      }
    } catch {
      // Body parsing failed - continue without request token
    }
  }

  // Get token from cookie (set by server after login)
  let cookieToken = getCookie(c, CSRF_COOKIE_NAME)
  if (!cookieToken && !requestToken) {
    log.warn("CSRF validation failed: missing cookie and request token", { path, method })
    return c.json({ error: "csrf_required", message: "CSRF token required" }, 403)
  }

  if (!requestToken && cookieToken) {
    requestToken = cookieToken
  }

  // Tokens must match (double-submit pattern)
  if (cookieToken && cookieToken !== requestToken) {
    log.warn("CSRF validation failed: token mismatch", { path, method })
    return c.json({ error: "csrf_invalid", message: "Invalid CSRF token" }, 403)
  }

  // Validate HMAC signature (session binding)
  const sessionId = c.get("sessionId") as string | undefined
  if (!sessionId) {
    log.warn("CSRF validation failed: no session ID in context", { path, method })
    return c.json({ error: "csrf_invalid", message: "Invalid CSRF token" }, 403)
  }

  const secret = getCSRFSecret()
  const tokenToValidate = requestToken ?? cookieToken
  if (!tokenToValidate) {
    log.warn("CSRF validation failed: missing token after parsing", { path, method })
    return c.json({ error: "csrf_required", message: "CSRF token required" }, 403)
  }

  const isValid = validateCSRFToken(tokenToValidate, sessionId, secret)

  if (!isValid) {
    log.warn("CSRF validation failed: invalid signature", { path, method, sessionId })

    // Verbose errors for debugging (default off in production)
    const message = authConfig.csrfVerboseErrors
      ? "CSRF token signature invalid (session mismatch or tampered)"
      : "Invalid CSRF token"

    return c.json({ error: "csrf_invalid", message }, 403)
  }

  if (!cookieToken && requestToken) {
    const isHttps = c.req.url.startsWith("https://")
    setCookie(c, CSRF_COOKIE_NAME, requestToken, {
      httpOnly: false,
      secure: isHttps,
      sameSite: "Lax",
      path: "/",
    })
  }

  // Validation passed
  return next()
})
