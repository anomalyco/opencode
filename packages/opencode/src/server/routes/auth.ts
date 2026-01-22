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
 * Polished HTML login page matching opencode design.
 */
const loginPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - opencode</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .logo {
      width: 80px;
      height: 100px;
      margin-bottom: 2rem;
    }
    .card {
      width: 100%;
      max-width: 360px;
      padding: 2rem;
      background: #141414;
      border: 1px solid #262626;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.3);
    }
    form { display: flex; flex-direction: column; gap: 1.25rem; }
    .field { display: flex; flex-direction: column; gap: 0.5rem; }
    label {
      font-size: 0.75rem;
      font-weight: 500;
      color: #a3a3a3;
      letter-spacing: 0.01em;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      height: 36px;
      padding: 0 12px;
      border: 1px solid #333;
      border-radius: 8px;
      background: #1a1a1a;
      color: #e5e5e5;
      font-size: 14px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus {
      outline: none;
      border-color: #525252;
      box-shadow: 0 0 0 3px rgba(82,82,82,0.3), 0 0 0 1px #525252;
    }
    input.invalid {
      background: rgba(239,68,68,0.1);
      border-color: #dc2626;
      box-shadow: 0 0 0 3px rgba(220,38,38,0.3), 0 0 0 1px #dc2626;
    }
    input.invalid:focus {
      border-color: #dc2626;
      box-shadow: 0 0 0 3px rgba(220,38,38,0.3), 0 0 0 1px #dc2626;
    }
    input::placeholder { color: #525252; }
    .password-toggle {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      color: #737373;
      transition: background-color 0.15s, color 0.15s;
    }
    .password-toggle:hover { background: #262626; }
    .password-toggle.active { color: #0ea5e9; }
    .password-toggle svg { width: 16px; height: 16px; }
    .password-input { padding-right: 36px; }
    .checkbox-wrapper {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: -0.25rem;
    }
    input[type="checkbox"] {
      width: 16px;
      height: 16px;
      accent-color: #0ea5e9;
      cursor: pointer;
    }
    .checkbox-label {
      font-size: 0.875rem;
      color: #a3a3a3;
      cursor: pointer;
      user-select: none;
    }
    .error {
      color: #fca5a5;
      font-size: 0.75rem;
      padding: 0.75rem;
      background: rgba(239,68,68,0.15);
      border: 1px solid rgba(239,68,68,0.3);
      border-radius: 8px;
      display: none;
    }
    .error.visible { display: block; }
    button[type="submit"] {
      height: 40px;
      border: none;
      border-radius: 8px;
      background: #e5e5e5;
      color: #0a0a0a;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.15s;
      margin-top: 0.5rem;
    }
    button[type="submit"]:hover { background: #d4d4d4; }
    button[type="submit"]:disabled {
      background: #404040;
      color: #737373;
      cursor: not-allowed;
    }
    @media (max-width: 480px) {
      .card { padding: 1.5rem; border-radius: 8px; }
      .logo { width: 60px; height: 75px; margin-bottom: 1.5rem; }
    }
  </style>
</head>
<body>
  <svg class="logo" viewBox="0 0 80 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M60 80H20V40H60V80Z" fill="#525252"/>
    <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="#e5e5e5"/>
  </svg>

  <div class="card">
    <form id="loginForm">
      <div id="error" class="error"></div>

      <div class="field">
        <label for="username">Username</label>
        <div class="input-wrapper">
          <input type="text" id="username" name="username" required autocomplete="username" autofocus>
        </div>
      </div>

      <div class="field">
        <label for="password">Password</label>
        <div class="input-wrapper">
          <input type="password" id="password" name="password" required autocomplete="current-password" class="password-input">
          <button type="button" class="password-toggle" id="passwordToggle" aria-label="Show password" aria-pressed="false">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 4.58325C5.83333 4.58325 2.5 9.99992 2.5 9.99992C2.5 9.99992 5.83333 15.4166 10 15.4166C14.1667 15.4166 17.5 9.99992 17.5 9.99992C17.5 9.99992 14.1667 4.58325 10 4.58325Z"/>
              <circle cx="10" cy="10" r="2.5"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="checkbox-wrapper">
        <input type="checkbox" id="rememberMe" name="rememberMe">
        <label for="rememberMe" class="checkbox-label">Remember me</label>
      </div>

      <button type="submit" id="submitBtn">Sign In</button>
    </form>
  </div>

  <script>
    const form = document.getElementById('loginForm');
    const errorDiv = document.getElementById('error');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const passwordToggle = document.getElementById('passwordToggle');
    const submitBtn = document.getElementById('submitBtn');

    // Password visibility toggle
    passwordToggle.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      passwordToggle.classList.toggle('active', isPassword);
      passwordToggle.setAttribute('aria-pressed', isPassword);
      passwordToggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorDiv.classList.remove('visible');
      errorDiv.textContent = '';

      // Validate
      let valid = true;
      if (!usernameInput.value.trim()) {
        usernameInput.classList.add('invalid');
        valid = false;
      } else {
        usernameInput.classList.remove('invalid');
      }
      if (!passwordInput.value) {
        passwordInput.classList.add('invalid');
        valid = false;
      } else {
        passwordInput.classList.remove('invalid');
      }
      if (!valid) return;

      // Submit
      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      try {
        const res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({
            username: usernameInput.value,
            password: passwordInput.value,
          }),
        });
        if (res.ok) {
          // Keep button disabled during redirect
          submitBtn.textContent = 'Redirecting...';
          window.location.href = '/';
        } else {
          const data = await res.json();
          errorDiv.textContent = data.message || 'Authentication failed';
          errorDiv.classList.add('visible');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In';
        }
      } catch (err) {
        errorDiv.textContent = 'Connection error';
        errorDiv.classList.add('visible');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });

    // Clear invalid state on input
    usernameInput.addEventListener('input', () => usernameInput.classList.remove('invalid'));
    passwordInput.addEventListener('input', () => passwordInput.classList.remove('invalid'));
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
        // Auth middleware skips /auth/* routes, so manually look up session
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
          lastAccessTime: session.lastAccessTime,
          uid: session.uid,
          gid: session.gid,
          home: session.home,
          shell: session.shell,
        })
      },
    ),
)
