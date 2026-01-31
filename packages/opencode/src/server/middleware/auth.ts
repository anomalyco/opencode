import { createMiddleware } from "hono/factory"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import type { Context } from "hono"
import { UserSession } from "../../session/user-session"
import { ServerAuth } from "../../config/server-auth"
import { parseDuration } from "../../util/duration"
import { getUiDir } from "../ui-dir"
import { Filesystem } from "../../util/filesystem"
import nodePath from "node:path"

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
 *
 * @param c - Hono context
 * @param sessionId - Session ID to set
 * @param rememberMe - If true, set persistent cookie with rememberMeDuration
 */
export function setSessionCookie(c: Context, sessionId: string, rememberMe?: boolean): void {
  const isHttps = c.req.url.startsWith("https://")
  const authConfig = ServerAuth.get()

  const cookieOptions: Parameters<typeof setCookie>[3] = {
    path: "/",
    httpOnly: true,
    sameSite: "Strict",
    secure: isHttps,
  }

  // Add maxAge for persistent cookies when rememberMe is true
  if (rememberMe) {
    const rememberMeDurationStr = authConfig.rememberMeDuration ?? "90d"
    const durationMs = parseDuration(rememberMeDurationStr) ?? 7776000000 // 90 days default
    // CRITICAL: Hono uses seconds for maxAge, not milliseconds
    cookieOptions.maxAge = Math.floor(durationMs / 1000)
  }

  setCookie(c, COOKIE_NAME, sessionId, cookieOptions)
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

  // Handle public routes that don't require auth
  const path = c.req.path

  // Health check endpoints are always public
  if (path === "/global/health" || path === "/health") {
    return next()
  }

  const isUiStaticRequest = async () => {
    const method = c.req.method.toUpperCase()
    if (method !== "GET" && method !== "HEAD") return false

    const uiDir = getUiDir()
    if (!uiDir) return false

    const relativePath = path.replace(/^\/+/, "")
    if (!relativePath) return false

    const resolvedPath = nodePath.resolve(uiDir, relativePath)
    if (!Filesystem.contains(uiDir, resolvedPath)) return false
    if (await Filesystem.isDir(resolvedPath)) return false
    if (!(await Filesystem.exists(resolvedPath))) return false

    return true
  }

  if (await isUiStaticRequest()) {
    return next()
  }

  // Auth routes handle their own authentication
  if (path.startsWith("/auth/")) {
    // For all auth routes, set sessionId if session exists
    // This is needed for CSRF validation (HMAC signature check)
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
    // Don't block - auth routes handle their own auth requirements
    return next()
  }

  // Helper to determine if request is an API call (vs browser navigation)
  // Browser navigation includes text/html in Accept header
  const isApiCall = () => {
    const accept = c.req.header("Accept") ?? ""
    // If Accept doesn't include text/html, it's likely an API call
    // This handles SDK requests that may not set explicit JSON accept
    return !accept.includes("text/html")
  }

  // Helper to return auth error (401 for API, redirect for browser)
  const authError = (message: string) => {
    if (isApiCall()) {
      return c.json({ error: message }, 401)
    }
    return c.redirect("/auth/login")
  }

  // Get session ID from cookie
  const sessionId = getCookie(c, COOKIE_NAME)
  if (!sessionId) {
    return authError("Not authenticated")
  }

  // Get session from store
  const session = UserSession.get(sessionId)
  if (!session) {
    // Stale cookie - clear it
    clearSessionCookie(c)
    return authError("Session not found")
  }

  // Check idle timeout - use rememberMeDuration for remember-me sessions
  const timeoutStr = session.rememberMe ? (authConfig.rememberMeDuration ?? "90d") : (authConfig.sessionTimeout ?? "7d")
  const timeout = parseDuration(timeoutStr) ?? DEFAULT_TIMEOUT_MS
  const elapsed = Date.now() - session.lastAccessTime

  if (elapsed > timeout) {
    // Session expired - clean up and redirect
    UserSession.remove(sessionId)
    clearSessionCookie(c)
    return authError("Session expired")
  }

  // Update lastAccessTime (sliding expiration)
  UserSession.touch(sessionId)

  // Check if user needs to complete 2FA setup
  if (session.twoFactorPending && authConfig.twoFactorRequired) {
    // User must complete 2FA setup before accessing other pages
    const isApiCall = () => {
      const accept = c.req.header("Accept") ?? ""
      return !accept.includes("text/html")
    }
    if (isApiCall()) {
      return c.json({ error: "2fa_setup_required", message: "Two-factor authentication setup is required" }, 403)
    }
    return c.redirect("/auth/2fa/setup?required=1")
  }

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
