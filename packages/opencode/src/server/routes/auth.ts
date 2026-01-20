import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { getCookie } from "hono/cookie"
import z from "zod"
import { UserSession } from "../../session/user-session"
import { clearSessionCookie, setSessionCookie, type AuthEnv } from "../middleware/auth"
import { lazy } from "../../util/lazy"
import { BrokerClient } from "../../auth/broker-client"
import { getUserInfo } from "../../auth/user-info"
import { ServerAuth } from "../../config/server-auth"

/**
 * Login request schema - accepts username and password.
 */
const loginRequestSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1),
  returnUrl: z.string().optional(),
})

/**
 * Validate that a return URL is safe (same-origin only).
 */
function isValidReturnUrl(url: string): boolean {
  // Must start with / (relative path)
  if (!url.startsWith("/")) return false
  // Must not have protocol or double slashes (prevent //evil.com)
  if (url.startsWith("//")) return false
  // Must not contain newlines (header injection)
  if (url.includes("\n") || url.includes("\r")) return false
  return true
}

/**
 * Auth routes for session management.
 *
 * - POST /login - Login with username and password
 * - GET /status - Get auth configuration status
 * - POST /logout - Logout current session
 * - POST /logout/all - Logout all sessions for user
 * - GET /session - Get current session info
 */
export const AuthRoutes = lazy(() =>
  new Hono<AuthEnv>()
    .post(
      "/login",
      describeRoute({
        summary: "Login with username and password",
        description: "Authenticate user credentials via PAM and create session.",
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
          400: { description: "Bad request (missing fields or invalid returnUrl)" },
          401: { description: "Authentication failed" },
          403: { description: "Authentication disabled" },
        },
      }),
      async (c) => {
        // 1. Check if auth is enabled
        const authConfig = ServerAuth.get()
        if (!authConfig.enabled) {
          return c.json({ error: "auth_disabled", message: "Authentication is not enabled" }, 403)
        }

        // 2. Check X-Requested-With header for basic CSRF protection
        const xrw = c.req.header("X-Requested-With")
        if (!xrw) {
          return c.json({ error: "csrf_missing", message: "X-Requested-With header required" }, 400)
        }

        // 3. Parse body based on Content-Type
        let body: { username?: string; password?: string; returnUrl?: string }
        const contentType = c.req.header("Content-Type") ?? ""

        if (contentType.includes("application/json")) {
          body = await c.req.json()
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const form = await c.req.parseBody()
          body = {
            username: form.username ? String(form.username) : undefined,
            password: form.password ? String(form.password) : undefined,
            returnUrl: form.returnUrl ? String(form.returnUrl) : undefined,
          }
        } else {
          return c.json(
            { error: "invalid_content_type", message: "Content-Type must be application/json or application/x-www-form-urlencoded" },
            400,
          )
        }

        // 4. Validate body
        const parsed = loginRequestSchema.safeParse(body)
        if (!parsed.success) {
          return c.json({ error: "invalid_request", message: "Username and password are required" }, 400)
        }
        const { username, password, returnUrl } = parsed.data

        // 5. Validate returnUrl (same-origin only)
        if (returnUrl && !isValidReturnUrl(returnUrl)) {
          return c.json({ error: "invalid_return_url", message: "Invalid return URL" }, 400)
        }

        // 6. Authenticate via broker
        const broker = new BrokerClient()
        const authResult = await broker.authenticate(username, password)

        if (!authResult.success) {
          // Generic error message - no user enumeration
          return c.json({ error: "auth_failed", message: "Authentication failed" }, 401)
        }

        // 7. Look up user info (UID, GID, home, shell)
        const userInfo = await getUserInfo(username)
        if (!userInfo) {
          // User authenticated but not found in passwd - shouldn't happen but handle gracefully
          return c.json({ error: "auth_failed", message: "Authentication failed" }, 401)
        }

        // 8. Create session with full user info
        const session = UserSession.create(username, c.req.header("User-Agent"), {
          uid: userInfo.uid,
          gid: userInfo.gid,
          home: userInfo.home,
          shell: userInfo.shell,
        })

        // 9. Set session cookie
        setSessionCookie(c, session.id)

        // 10. Return success with user info
        return c.json({
          success: true as const,
          user: {
            username: session.username,
            uid: userInfo.uid,
            gid: userInfo.gid,
            home: userInfo.home,
            shell: userInfo.shell,
          },
        })
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get auth status",
        description: "Check if authentication is enabled and get configuration.",
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
        const authConfig = ServerAuth.get()
        return c.json({
          enabled: authConfig.enabled,
          method: authConfig.enabled ? authConfig.method : undefined,
        })
      },
    )
    .post(
      "/logout",
      describeRoute({
        summary: "Logout current session",
        description: "Clear the current session and redirect to login page.",
        operationId: "auth.logout",
        responses: {
          302: {
            description: "Redirect to login page",
          },
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
    .post(
      "/logout/all",
      describeRoute({
        summary: "Logout all sessions",
        description: "Clear all sessions for the current user and redirect to login page.",
        operationId: "auth.logoutAll",
        responses: {
          302: {
            description: "Redirect to login page",
          },
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
    .get(
      "/session",
      describeRoute({
        summary: "Get current session",
        description: "Retrieve information about the current authenticated session.",
        operationId: "auth.session",
        responses: {
          200: {
            description: "Current session info",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    username: z.string(),
                    createdAt: z.number(),
                    lastAccessTime: z.number(),
                  }),
                ),
              },
            },
          },
          401: {
            description: "Not authenticated",
          },
        },
      }),
      async (c) => {
        const session = c.get("session")
        if (!session) {
          return c.json({ error: "Not authenticated" }, 401)
        }
        return c.json({
          id: session.id,
          username: session.username,
          createdAt: session.createdAt,
          lastAccessTime: session.lastAccessTime,
        })
      },
    ),
)
