import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { getCookie } from "hono/cookie"
import z from "zod"
import { UserSession } from "../../session/user-session"
import { clearSessionCookie, setSessionCookie, type AuthEnv } from "../middleware/auth"
import { lazy } from "../../util/lazy"
import { BrokerClient, type UserInfo } from "../../auth/broker-client"
import { getUserInfo } from "../../auth/user-info"
import { ServerAuth } from "../../config/server-auth"
import { Log } from "../../util/log"

const log = Log.create({ service: "auth-routes" })

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
 * Simple HTML login page for direct backend access.
 */
const loginPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - opencode</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { width: 100%; max-width: 360px; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; text-align: center; }
    form { display: flex; flex-direction: column; gap: 1rem; }
    label { font-size: 0.875rem; color: #a3a3a3; }
    input { width: 100%; padding: 0.75rem; border: 1px solid #333; border-radius: 6px; background: #171717; color: #e5e5e5; font-size: 1rem; }
    input:focus { outline: none; border-color: #0ea5e9; }
    button { padding: 0.75rem; border: none; border-radius: 6px; background: #0ea5e9; color: white; font-size: 1rem; cursor: pointer; }
    button:hover { background: #0284c7; }
    .error { color: #ef4444; font-size: 0.875rem; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>opencode</h1>
    <form id="loginForm">
      <div>
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username">
      </div>
      <div>
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <div id="error" class="error"></div>
      <button type="submit">Sign In</button>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const error = document.getElementById('error');
      error.textContent = '';
      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
          }),
        });
        if (res.ok) {
          window.location.href = '/';
        } else {
          const data = await res.json();
          error.textContent = data.message || 'Authentication failed';
        }
      } catch (err) {
        error.textContent = 'Connection error';
      }
    });
  </script>
</body>
</html>`

/**
 * Auth routes for session management.
 *
 * - GET /login - Login page (HTML)
 * - POST /login - Login with username and password
 * - GET /status - Get auth configuration status
 * - POST /logout - Logout current session
 * - POST /logout/all - Logout all sessions for user
 * - GET /session - Get current session info
 */
export const AuthRoutes = lazy(() =>
  new Hono<AuthEnv>()
    .get("/login", (c) => {
      return c.html(loginPageHtml)
    })
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

        // 10. Register session with broker for PTY operations (fire-and-forget)
        // If broker registration fails, user can still use web interface
        // PTY operations will fail gracefully with "session not found"
        const userInfoForBroker: UserInfo = {
          username,
          uid: userInfo.uid,
          gid: userInfo.gid,
          home: userInfo.home,
          shell: userInfo.shell,
        }
        const brokerForRegistration = new BrokerClient()
        brokerForRegistration.registerSession(session.id, userInfoForBroker).catch((err) => {
          log.warn("Failed to register session with broker", { error: err })
        })

        // 11. Return success with user info
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
          // Unregister session from broker (fire-and-forget)
          // Session removal proceeds regardless of broker call result
          const authConfig = ServerAuth.get()
          if (authConfig.enabled) {
            const brokerForUnregistration = new BrokerClient()
            brokerForUnregistration.unregisterSession(sessionId).catch((err) => {
              log.warn("Failed to unregister session from broker", { error: err })
            })
          }
          UserSession.remove(sessionId)
        }
        clearSessionCookie(c)
        return c.redirect("/auth/login")
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
          // Unregister all sessions from broker (fire-and-forget)
          const authConfig = ServerAuth.get()
          if (authConfig.enabled) {
            const sessionIds = UserSession.getSessionIdsForUser(session.username)
            const brokerForUnregistration = new BrokerClient()
            for (const sessionId of sessionIds) {
              brokerForUnregistration.unregisterSession(sessionId).catch((err) => {
                log.warn("Failed to unregister session from broker", { error: err, sessionId })
              })
            }
          }
          UserSession.removeAllForUser(session.username)
        }
        clearSessionCookie(c)
        return c.redirect("/auth/login")
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
