import { createMiddleware } from "hono/factory"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import type { Context } from "hono"
import { UserSession } from "../../session/user-session"
import { ServerAuth } from "../../config/server-auth"
import { parseDuration } from "../../util/duration"

/**
 * Auth context with essential session information.
 * Extracted for use by route handlers.
 */
export interface AuthContext {
  sessionId: string
  username: string
  uid?: number
  gid?: number
}

/**
 * Type definition for auth context variables.
 * Available after authMiddleware runs on protected routes.
 */
export type AuthEnv = {
  Variables: {
    session: UserSession.Info
    username: string
    sessionId: string
    auth: AuthContext
  }
}

const COOKIE_NAME = "opencode_session"
const DEFAULT_TIMEOUT_MS = 604800000 // 7 days

/**
 * Set session cookie with security options.
 */
export function setSessionCookie(c: Context, sessionId: string): void {
  const isHttps = c.req.url.startsWith("https://")
  setCookie(c, COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "Strict",
    secure: isHttps,
  })
}

/**
 * Clear session cookie.
 */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" })
}

/**
 * Auth middleware for session validation.
 *
 * - Skips auth when config.auth.enabled is false
 * - Validates session cookie existence
 * - Checks idle timeout (sliding expiration)
 * - Sets session and username in context variables
 */
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authConfig = ServerAuth.get()

  // Skip auth when disabled
  if (!authConfig.enabled) {
    return next()
  }

  // Handle auth routes specially
  const path = c.req.path
  if (path.startsWith("/auth/")) {
    // For logout routes, still try to set sessionId if session exists
    // This is needed for CSRF validation (HMAC signature check)
    if (path === "/auth/logout" || path === "/auth/logout/all") {
      const sessionId = getCookie(c, COOKIE_NAME)
      if (sessionId) {
        const session = UserSession.get(sessionId)
        if (session) {
          c.set("session", session)
          c.set("username", session.username)
          c.set("sessionId", session.id)
          c.set("auth", {
            sessionId: session.id,
            username: session.username,
            uid: session.uid,
            gid: session.gid,
          } as AuthContext)
        }
      }
    }
    // Don't block - auth routes handle their own auth requirements
    return next()
  }

  // Get session ID from cookie
  const sessionId = getCookie(c, COOKIE_NAME)
  if (!sessionId) {
    return c.redirect("/auth/login")
  }

  // Get session from store
  const session = UserSession.get(sessionId)
  if (!session) {
    // Stale cookie - clear it
    clearSessionCookie(c)
    return c.redirect("/auth/login")
  }

  // Check idle timeout
  const timeoutStr = authConfig.sessionTimeout ?? "7d"
  const timeout = parseDuration(timeoutStr) ?? DEFAULT_TIMEOUT_MS
  const elapsed = Date.now() - session.lastAccessTime

  if (elapsed > timeout) {
    // Session expired - clean up and redirect
    UserSession.remove(sessionId)
    clearSessionCookie(c)
    return c.redirect("/auth/login")
  }

  // Update lastAccessTime (sliding expiration)
  UserSession.touch(sessionId)

  // Set context variables for downstream handlers
  c.set("session", session)
  c.set("username", session.username)
  c.set("sessionId", session.id)

  // Set structured auth context
  const auth: AuthContext = {
    sessionId: session.id,
    username: session.username,
    uid: session.uid,
    gid: session.gid,
  }
  c.set("auth", auth)

  return next()
})

/**
 * Get the auth context from a Hono context.
 *
 * Returns undefined if auth is disabled or user is not authenticated.
 * Use this in route handlers to check authentication and get session info.
 */
export function getAuthContext(c: Context): AuthContext | undefined {
  return c.get("auth") as AuthContext | undefined
}
