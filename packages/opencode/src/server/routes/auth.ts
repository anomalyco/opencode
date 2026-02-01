import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { getCookie, setCookie } from "hono/cookie"
import z from "zod"
import { UserSession } from "../../session/user-session"
import { clearSessionCookie, setSessionCookie, type AuthEnv } from "../middleware/auth"
import { setCSRFCookie, clearCSRFCookie } from "../middleware/csrf"
import { CSRF_COOKIE_NAME, getCSRFSecret, validateCSRFToken } from "../security/csrf"
import { lazy } from "../../util/lazy"
import { BrokerClient, type UserInfo } from "../../auth/broker-client"
import { getUserInfo } from "../../auth/user-info"
import { ServerAuth } from "../../config/server-auth"
import { Log } from "../../util/log"
import { createManualRateLimiter, getClientIP, type ManualRateLimiter } from "../security/rate-limit"
import { parseDuration } from "../../util/duration"
import { getConnectionSecurityInfo, shouldBlockInsecureLogin } from "../security/https-detection"
import { create2FAToken, verify2FAToken, type TwoFactorUserInfo } from "../../auth/two-factor-token"
import { verifyDeviceTrustToken, createDeviceTrustToken, createDeviceFingerprint } from "../../auth/device-trust"
import { getTokenSecret } from "../security/token-secret"
import { generateTotpSetup, getGoogleAuthenticatorSetupCommand, verifyTotpCode } from "../../auth/totp-setup"
import { getTwoFactorPreference, setTwoFactorPreference } from "../../auth/two-factor-preference"
import { getUiDir } from "../ui-dir"
import path from "node:path"

const log = Log.create({ service: "auth-routes" })

async function ensureBrokerSession(sessionId: string, session: UserSession.Info): Promise<boolean> {
  let { uid, gid, home, shell } = session
  if (uid === undefined || gid === undefined || !home || !shell) {
    const userInfo = await getUserInfo(session.username)
    if (!userInfo) return false
    uid = userInfo.uid
    gid = userInfo.gid
    home = userInfo.home
    shell = userInfo.shell
    session.uid = userInfo.uid
    session.gid = userInfo.gid
    session.home = userInfo.home
    session.shell = userInfo.shell
  }

  const userInfoForBroker: UserInfo = {
    username: session.username,
    uid,
    gid,
    home,
    shell,
  }

  const broker = new BrokerClient()
  try {
    await broker.registerSession(sessionId, userInfoForBroker)
    return true
  } catch {
    return false
  }
}

/**
 * Security event types for logging.
 */
interface SecurityEvent {
  type: "login_failed" | "login_success" | "rate_limit" | "csrf_violation"
  ip: string
  username?: string
  reason?: string
  timestamp: string
  userAgent?: string
}

/**
 * Log a security event with privacy masking.
 */
function logSecurityEvent(event: SecurityEvent): void {
  // Mask username for privacy (pe*** format)
  const maskedUsername = event.username ? maskUsername(event.username) : undefined
  log.warn("[SECURITY]", {
    event_type: event.type,
    ip: event.ip,
    username: maskedUsername,
    reason: event.reason,
    timestamp: event.timestamp,
    user_agent: event.userAgent,
  })
}

/**
 * Mask username to protect privacy.
 * Format: first 2 chars + *** + last char (pe***r)
 */
function maskUsername(username: string): string {
  if (username.length <= 3) return "***"
  return username.slice(0, 2) + "***" + username.slice(-1)
}

/**
 * Login request schema - accepts username, password, and optional rememberMe.
 */
const loginRequestSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1),
  returnUrl: z.string().optional(),
  rememberMe: z.boolean().optional(),
})

/**
 * Lazy-initialized manual rate limiter for login endpoint.
 * Only counts failed attempts - successful logins don't increment counter.
 */
const loginRateLimiter = lazy((): ManualRateLimiter | undefined => {
  const authConfig = ServerAuth.get()
  if (!authConfig.enabled || authConfig.rateLimiting === false) {
    return undefined
  }
  const windowMs = parseDuration(authConfig.rateLimitWindow ?? "15m") ?? 15 * 60 * 1000
  return createManualRateLimiter({
    windowMs,
    limit: authConfig.rateLimitMax ?? 5,
  })
})

/**
 * Lazy-initialized manual rate limiter for OTP validation.
 * Only counts failed attempts - successful OTP validations don't increment counter.
 */
const otpRateLimiter = lazy((): ManualRateLimiter | undefined => {
  const authConfig = ServerAuth.get()
  if (!authConfig.enabled || authConfig.rateLimiting === false) {
    return undefined
  }
  const windowMs = parseDuration(authConfig.otpRateLimitWindow ?? "15m") ?? 15 * 60 * 1000
  return createManualRateLimiter({
    windowMs,
    limit: authConfig.otpRateLimitMax ?? 5,
  })
})

/**
 * Validate that a return URL is safe.
 * Allows:
 * - Relative paths starting with /
 * - Localhost URLs (for development with separate frontend server)
 */
function isValidReturnUrl(url: string): boolean {
  // Must not contain newlines (header injection)
  if (url.includes("\n") || url.includes("\r")) return false

  // Allow relative paths starting with /
  if (url.startsWith("/") && !url.startsWith("//")) {
    return true
  }

  // Allow localhost URLs (for development)
  try {
    const parsed = new URL(url)
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return true
    }
  } catch {
    // Invalid URL
  }

  return false
}

/**
 * Generate login page HTML with security context.
 */
let cachedLoginTemplate: string | undefined
let cachedLoginTemplatePath: string | undefined
let cachedTwoFactorTemplate: string | undefined
let cachedTwoFactorTemplatePath: string | undefined
let cachedTwoFactorSetupTemplate: string | undefined
let cachedTwoFactorSetupTemplatePath: string | undefined

async function loadLoginTemplate(uiDir: string): Promise<string> {
  const templatePath = path.join(uiDir, "login.html")
  if (cachedLoginTemplate && cachedLoginTemplatePath === templatePath) {
    return cachedLoginTemplate
  }

  const file = Bun.file(templatePath)
  const exists = await file.exists()
  if (!exists) {
    throw new Error(`Login HTML not found at ${templatePath}`)
  }

  cachedLoginTemplate = await file.text()
  cachedLoginTemplatePath = templatePath
  return cachedLoginTemplate
}

function injectLoginBootstrap(
  template: string,
  securityContext: { shouldWarn: boolean; shouldBlock: boolean; isSecure: boolean },
): string {
  const bootstrap = `<script>window.__OPENCODE_LOGIN__ = ${JSON.stringify(securityContext)};</script>`
  if (template.includes("</head>")) {
    return template.replace("</head>", `${bootstrap}\n</head>`)
  }
  if (template.includes("</body>")) {
    return template.replace("</body>", `${bootstrap}\n</body>`)
  }
  return `${template}\n${bootstrap}`
}

/**
 * Load 2FA verification page HTML.
 */
async function loadTwoFactorTemplate(uiDir: string): Promise<string> {
  const templatePath = path.join(uiDir, "2fa.html")
  if (cachedTwoFactorTemplate && cachedTwoFactorTemplatePath === templatePath) {
    return cachedTwoFactorTemplate
  }

  const file = Bun.file(templatePath)
  const exists = await file.exists()
  if (!exists) {
    throw new Error(`2FA HTML not found at ${templatePath}`)
  }

  cachedTwoFactorTemplate = await file.text()
  cachedTwoFactorTemplatePath = templatePath
  return cachedTwoFactorTemplate
}

function injectTwoFactorBootstrap(
  template: string,
  bootstrap: { token: string; username: string; timeoutSeconds: number },
): string {
  const script = `<script>window.__OPENCODE_2FA__ = ${JSON.stringify(bootstrap)};</script>`
  if (template.includes("</head>")) {
    return template.replace("</head>", `${script}\n</head>`)
  }
  if (template.includes("</body>")) {
    return template.replace("</body>", `${script}\n</body>`)
  }
  return `${template}\n${script}`
}

/**
 * Load 2FA setup page HTML.
 */
async function loadTwoFactorSetupTemplate(uiDir: string): Promise<string> {
  const templatePath = path.join(uiDir, "2fa-setup.html")
  if (cachedTwoFactorSetupTemplate && cachedTwoFactorSetupTemplatePath === templatePath) {
    return cachedTwoFactorSetupTemplate
  }

  const file = Bun.file(templatePath)
  const exists = await file.exists()
  if (!exists) {
    throw new Error(`2FA setup HTML not found at ${templatePath}`)
  }

  cachedTwoFactorSetupTemplate = await file.text()
  cachedTwoFactorSetupTemplatePath = templatePath
  return cachedTwoFactorSetupTemplate
}

function injectTwoFactorSetupBootstrap(
  template: string,
  bootstrap: {
    username: string
    secret: string
    qrCodeSvg: string
    setupCommand?: string
    alreadyConfigured: boolean
    required: boolean
    setupStatus: "pending_verification" | "already_configured" | "manual_required"
    setupMessage?: string
  },
): string {
  const script = `<script>window.__OPENCODE_2FA_SETUP__ = ${JSON.stringify(bootstrap)};</script>`
  if (template.includes("</head>")) {
    return template.replace("</head>", `${script}\n</head>`)
  }
  if (template.includes("</body>")) {
    return template.replace("</body>", `${script}\n</body>`)
  }
  return `${template}\n${script}`
}

/**
 * Auth routes for session management.
 *
 * - GET /login - Login page (HTML)
 * - POST /login - Login with username and password
 * - GET /2fa - 2FA verification page (HTML)
 * - POST /login/2fa - Complete 2FA login
 * - GET /status - Get auth configuration status
 * - POST /logout - Logout current session
 * - POST /logout/all - Logout all sessions for user
 * - GET /session - Get current session info
 */
export const AuthRoutes = lazy(() =>
  new Hono<AuthEnv>()
    .get("/login", async (c) => {
      // Get security context for connection
      const authConfig = ServerAuth.get()
      const securityContext = getConnectionSecurityInfo(c, {
        requireHttps: authConfig.requireHttps,
        trustProxy: authConfig.trustProxy,
      })

      const uiDir = getUiDir()
      if (!uiDir) {
        return c.text("Login UI is not configured. Build the app UI and set uiDir.", 500)
      }

      try {
        const template = await loadLoginTemplate(uiDir)
        return c.html(injectLoginBootstrap(template, securityContext))
      } catch (error) {
        log.error("Failed to load login HTML", { error })
        return c.text("Login UI is missing. Run the app build to generate login.html.", 500)
      }
    })
    .get("/2fa", async (c) => {
      // Get token, username, timeout from query params
      const token = c.req.query("token")
      const username = c.req.query("username")
      const timeout = c.req.query("timeout")

      // If no token/username, redirect to login
      if (!token || !username) {
        return c.redirect("/auth/login")
      }

      const parsedTimeout = Number.parseInt(timeout ?? "300", 10)
      const timeoutSeconds = Number.isFinite(parsedTimeout) ? parsedTimeout : 300

      const uiDir = getUiDir()
      if (!uiDir) {
        return c.text("2FA UI is not configured. Build the app UI and set uiDir.", 500)
      }

      try {
        const template = await loadTwoFactorTemplate(uiDir)
        return c.html(injectTwoFactorBootstrap(template, { token, username, timeoutSeconds }))
      } catch (error) {
        log.error("Failed to load 2FA HTML", { error })
        return c.text("2FA UI is missing. Run the app build to generate 2fa.html.", 500)
      }
    })
    .post(
      "/login",
      describeRoute({
        summary: "Login with username and password",
        description:
          "Authenticate user credentials via PAM and create session. Returns 2fa_required if user has 2FA enabled.",
        operationId: "auth.login",
        responses: {
          200: {
            description: "Login successful or 2FA required",
            content: {
              "application/json": {
                schema: resolver(
                  z.union([
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
                    z.object({
                      success: z.literal(false),
                      error: z.literal("2fa_required"),
                      twoFactorToken: z.string(),
                      username: z.string(),
                      timeoutSeconds: z.number(),
                    }),
                  ]),
                ),
              },
            },
          },
          400: { description: "Bad request (missing fields or invalid returnUrl)" },
          401: { description: "Authentication failed" },
          403: { description: "Authentication disabled" },
          429: { description: "Rate limit exceeded" },
        },
      }),
      async (c) => {
        // 1. Check if auth is enabled
        const authConfig = ServerAuth.get()
        if (!authConfig.enabled) {
          return c.json({ error: "auth_disabled", message: "Authentication is not enabled" }, 403)
        }

        // 1a. Check HTTPS requirement
        if (
          shouldBlockInsecureLogin(c, {
            requireHttps: authConfig.requireHttps,
            trustProxy: authConfig.trustProxy,
          })
        ) {
          const ip = getClientIP(c)
          logSecurityEvent({
            type: "login_failed",
            ip,
            reason: "https_required",
            timestamp: new Date().toISOString(),
            userAgent: c.req.header("User-Agent"),
          })
          return c.json({ error: "https_required", message: "HTTPS is required for login" }, 403)
        }

        // 2. Check rate limiting if enabled
        const limiter = loginRateLimiter()
        if (limiter) {
          const rateLimitResult = limiter.checkRateLimit(c)
          if (rateLimitResult) {
            return rateLimitResult
          }
        }

        // 3. Check X-Requested-With header for basic CSRF protection
        const xrw = c.req.header("X-Requested-With")
        if (!xrw) {
          const ip = getClientIP(c)
          logSecurityEvent({
            type: "csrf_violation",
            ip,
            timestamp: new Date().toISOString(),
            userAgent: c.req.header("User-Agent"),
          })
          return c.json({ error: "csrf_missing", message: "X-Requested-With header required" }, 400)
        }

        // 4. Parse body based on Content-Type
        let body: { username?: string; password?: string; returnUrl?: string; rememberMe?: boolean }
        const contentType = c.req.header("Content-Type") ?? ""

        if (contentType.includes("application/json")) {
          body = await c.req.json()
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const form = await c.req.parseBody()
          body = {
            username: form.username ? String(form.username) : undefined,
            password: form.password ? String(form.password) : undefined,
            returnUrl: form.returnUrl ? String(form.returnUrl) : undefined,
            rememberMe: form.rememberMe === "on" || form.rememberMe === "true",
          }
        } else {
          return c.json(
            {
              error: "invalid_content_type",
              message: "Content-Type must be application/json or application/x-www-form-urlencoded",
            },
            400,
          )
        }

        // 5. Validate body
        const parsed = loginRequestSchema.safeParse(body)
        if (!parsed.success) {
          return c.json({ error: "invalid_request", message: "Username and password are required" }, 400)
        }
        const { username, password, returnUrl, rememberMe } = parsed.data

        // 6. Validate returnUrl (same-origin only)
        if (returnUrl && !isValidReturnUrl(returnUrl)) {
          return c.json({ error: "invalid_return_url", message: "Invalid return URL" }, 400)
        }

        // 7. Authenticate via broker
        const broker = new BrokerClient()
        const authResult = await broker.authenticate(username, password)

        const ip = getClientIP(c)
        const timestamp = new Date().toISOString()
        const userAgent = c.req.header("User-Agent")

        if (!authResult.success) {
          // Log failed login attempt
          logSecurityEvent({
            type: "login_failed",
            ip,
            username,
            reason: "invalid_credentials",
            timestamp,
            userAgent,
          })
          // Record failure for rate limiting
          limiter?.recordFailure(c)
          // Generic error message - no user enumeration
          return c.json({ error: "auth_failed", message: "Authentication failed" }, 401)
        }

        // 8. Look up user info (UID, GID, home, shell)
        const userInfo = await getUserInfo(username)
        if (!userInfo) {
          // User authenticated but not found in passwd - shouldn't happen but handle gracefully
          logSecurityEvent({
            type: "login_failed",
            ip,
            username,
            reason: "user_info_not_found",
            timestamp,
            userAgent,
          })
          // Record failure for rate limiting
          limiter?.recordFailure(c)
          return c.json({ error: "auth_failed", message: "Authentication failed" }, 401)
        }

        // 8a. Check if 2FA is required
        if (authConfig.twoFactorEnabled) {
          const has2fa = await broker.check2fa(username, userInfo.home)
          const preference = await getTwoFactorPreference(username)
          const skipSetup = preference.skipSetup && !authConfig.twoFactorRequired

          if (has2fa) {
            // Check device trust cookie first
            const deviceTrustCookie = getCookie(c, "opencode_device_trust")
            let deviceTrusted = false

            if (deviceTrustCookie) {
              const fingerprint = createDeviceFingerprint(userAgent ?? "")
              const trustedUser = await verifyDeviceTrustToken(deviceTrustCookie, fingerprint, getTokenSecret())
              if (trustedUser === username) {
                // Device is trusted - skip 2FA, continue to session creation
                deviceTrusted = true
              }
            }

            if (!deviceTrusted) {
              // Device not trusted or token invalid - require 2FA
              const tfaUserInfo: TwoFactorUserInfo = {
                username,
                uid: userInfo.uid,
                gid: userInfo.gid,
                home: userInfo.home,
                shell: userInfo.shell,
              }

              const timeoutMs = parseDuration(authConfig.twoFactorTokenTimeout ?? "5m") ?? 300000
              const timeoutSec = Math.floor(timeoutMs / 1000)

              const twoFactorToken = await create2FAToken(
                tfaUserInfo,
                timeoutSec,
                getTokenSecret(),
                ip, // Bind to requesting IP
              )

              return c.json(
                {
                  success: false as const,
                  error: "2fa_required" as const,
                  twoFactorToken,
                  username,
                  timeoutSeconds: timeoutSec,
                },
                200,
              ) // 200 because password was valid, just need 2FA
            }
          } else if (!skipSetup) {
            // User doesn't have 2FA configured - redirect to setup
            // Create session with twoFactorPending flag
            const tempSession = UserSession.create(
              username,
              c.req.header("User-Agent"),
              {
                uid: userInfo.uid,
                gid: userInfo.gid,
                home: userInfo.home,
                shell: userInfo.shell,
              },
              false, // Don't use rememberMe for setup session
            )
            // Mark session as pending 2FA setup
            tempSession.twoFactorPending = true
            setSessionCookie(c, tempSession.id, false)
            setCSRFCookie(c, tempSession.id)

            const userInfoForBroker: UserInfo = {
              username,
              uid: userInfo.uid,
              gid: userInfo.gid,
              home: userInfo.home,
              shell: userInfo.shell,
            }
            const brokerForRegistration = new BrokerClient()
            brokerForRegistration.registerSession(tempSession.id, userInfoForBroker).catch((err) => {
              log.warn("Failed to register setup session with broker", { error: err })
            })

            return c.json(
              {
                success: false as const,
                error: "2fa_setup_required" as const,
                message: authConfig.twoFactorRequired
                  ? "Two-factor authentication setup is required"
                  : "Two-factor authentication is recommended",
                canSkip: !authConfig.twoFactorRequired,
              },
              200,
            )
          }
        }

        // 9. Create session with full user info
        const session = UserSession.create(
          username,
          c.req.header("User-Agent"),
          {
            uid: userInfo.uid,
            gid: userInfo.gid,
            home: userInfo.home,
            shell: userInfo.shell,
          },
          rememberMe ?? false,
        )

        // 10. Set session cookie
        setSessionCookie(c, session.id, rememberMe ?? false)

        // 10a. Set CSRF cookie (regenerate token after successful login)
        setCSRFCookie(c, session.id)

        // 11. Register session with broker for PTY operations (fire-and-forget)
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

        // 12. Log successful login
        logSecurityEvent({
          type: "login_success",
          ip,
          username,
          timestamp,
          userAgent,
        })

        // 13. Return success with user info
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
    .post(
      "/login/2fa",
      describeRoute({
        summary: "Complete 2FA login",
        description: "Validate OTP code and complete authentication.",
        operationId: "auth.login2fa",
        responses: {
          200: {
            description: "2FA successful",
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
          400: { description: "Bad request (missing fields)" },
          401: { description: "OTP validation failed or token expired" },
          403: { description: "2FA not enabled" },
          429: { description: "Rate limit exceeded" },
        },
      }),
      async (c) => {
        const authConfig = ServerAuth.get()
        if (!authConfig.enabled || !authConfig.twoFactorEnabled) {
          return c.json({ error: "2fa_disabled", message: "Two-factor authentication is not enabled" }, 403)
        }

        // Check X-Requested-With for CSRF
        const xrw = c.req.header("X-Requested-With")
        if (!xrw) {
          const ip = getClientIP(c)
          logSecurityEvent({
            type: "csrf_violation",
            ip,
            timestamp: new Date().toISOString(),
            userAgent: c.req.header("User-Agent"),
          })
          return c.json({ error: "csrf_missing", message: "X-Requested-With header required" }, 400)
        }

        // Parse body
        const body = await c.req.json()
        const { twoFactorToken, code, rememberDevice } = body as {
          twoFactorToken?: string
          code?: string
          rememberDevice?: boolean
        }

        if (!twoFactorToken || !code) {
          return c.json({ error: "invalid_request", message: "Token and code are required" }, 400)
        }

        // Verify 2FA token
        const ip = getClientIP(c)
        const userInfo = await verify2FAToken(twoFactorToken, getTokenSecret(), ip)
        if (!userInfo) {
          return c.json({ error: "token_expired", message: "2FA session expired, please login again" }, 401)
        }

        // Check rate limiting for OTP attempts
        const otpLimiter = otpRateLimiter()
        if (otpLimiter) {
          const rateLimitResult = otpLimiter.checkRateLimit(c)
          if (rateLimitResult) return rateLimitResult
        }

        // Check OTP configuration first
        const broker = new BrokerClient()
        const otpConfig = await broker.checkOtpConfig()
        if (!otpConfig.configured) {
          // Return specific error based on what's misconfigured
          if (otpConfig.errorCode === "pam_module_not_installed") {
            return c.json(
              {
                error: "server_misconfigured",
                message: "Server configuration error: libpam-google-authenticator is not installed.",
              },
              500,
            )
          } else if (otpConfig.errorCode === "pam_service_not_configured") {
            return c.json(
              {
                error: "server_misconfigured",
                message: `Server configuration error: PAM service file missing at ${otpConfig.pamServicePath}`,
              },
              500,
            )
          } else if (otpConfig.errorCode === "broker_unavailable") {
            return c.json(
              {
                error: "server_error",
                message: "Authentication service unavailable. Please try again later.",
              },
              503,
            )
          } else {
            return c.json(
              {
                error: "server_misconfigured",
                message: "Server configuration error: OTP validation is not properly configured.",
              },
              500,
            )
          }
        }

        // Log if service file was auto-created
        if (otpConfig.serviceAutoCreated) {
          log.info("PAM service file auto-created", { path: otpConfig.pamServicePath })
        }

        // Validate OTP via broker
        const otpResult = await broker.authenticateOtp(userInfo.username, code)

        const timestamp = new Date().toISOString()
        const userAgent = c.req.header("User-Agent")

        if (!otpResult.success) {
          logSecurityEvent({
            type: "login_failed",
            ip,
            username: userInfo.username,
            reason: "invalid_otp",
            timestamp,
            userAgent,
          })
          // Record failure for rate limiting
          otpLimiter?.recordFailure(c)
          return c.json({ error: "invalid_code", message: "Invalid verification code" }, 401)
        }

        // Create session
        const session = UserSession.create(
          userInfo.username,
          userAgent,
          {
            uid: userInfo.uid,
            gid: userInfo.gid,
            home: userInfo.home,
            shell: userInfo.shell,
          },
          false, // 2FA login doesn't use rememberMe for session (device trust is separate)
        )

        // Set session cookie
        setSessionCookie(c, session.id, false)
        setCSRFCookie(c, session.id)

        // Set device trust cookie if requested
        if (rememberDevice) {
          const fingerprint = createDeviceFingerprint(userAgent ?? "")
          const trustDurationMs = parseDuration(authConfig.deviceTrustDuration ?? "30d") ?? 30 * 24 * 60 * 60 * 1000
          const trustDurationSec = Math.floor(trustDurationMs / 1000)

          const trustToken = await createDeviceTrustToken(
            userInfo.username,
            fingerprint,
            trustDurationSec,
            getTokenSecret(),
          )

          setCookie(c, "opencode_device_trust", trustToken, {
            path: "/",
            httpOnly: true,
            secure: c.req.url.startsWith("https"),
            sameSite: "Strict",
            maxAge: trustDurationSec,
          })
        }

        // Register session with broker
        const userInfoForBroker: UserInfo = {
          username: userInfo.username,
          uid: userInfo.uid,
          gid: userInfo.gid,
          home: userInfo.home,
          shell: userInfo.shell,
        }
        broker.registerSession(session.id, userInfoForBroker).catch((err) => {
          log.warn("Failed to register session with broker", { error: err })
        })

        // Log successful login
        logSecurityEvent({
          type: "login_success",
          ip,
          username: userInfo.username,
          timestamp,
          userAgent,
        })

        return c.json({
          success: true as const,
          user: {
            username: userInfo.username,
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
    .get(
      "/device-trust/status",
      describeRoute({
        summary: "Get device trust status",
        description: "Check if 2FA is enabled and if the current device is trusted.",
        operationId: "auth.deviceTrustStatus",
        responses: {
          200: {
            description: "Device trust status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    twoFactorEnabled: z.boolean(),
                    twoFactorConfigured: z.boolean(),
                    twoFactorOptedOut: z.boolean(),
                    deviceTrusted: z.boolean(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const authConfig = ServerAuth.get()
        const twoFactorEnabled = authConfig.enabled && authConfig.twoFactorEnabled === true

        const sessionId = getCookie(c, "opencode_session")
        const session = sessionId ? UserSession.get(sessionId) : undefined
        let twoFactorConfigured = false
        let twoFactorOptedOut = false

        if (twoFactorEnabled && session?.username) {
          const preference = await getTwoFactorPreference(session.username)
          twoFactorOptedOut = preference.skipSetup ?? false
          if (session.home) {
            const broker = new BrokerClient()
            twoFactorConfigured = await broker.check2fa(session.username, session.home)
          }
        }

        // Check for device trust cookie
        let deviceTrusted = false
        if (twoFactorEnabled) {
          const deviceTrustCookie = getCookie(c, "opencode_device_trust")
          if (deviceTrustCookie) {
            // Verify the cookie is valid
            const userAgent = c.req.header("User-Agent") ?? ""
            const fingerprint = createDeviceFingerprint(userAgent)
            const trustedUser = await verifyDeviceTrustToken(deviceTrustCookie, fingerprint, getTokenSecret())
            deviceTrusted = trustedUser !== null
          }
        }

        return c.json({
          twoFactorEnabled,
          twoFactorConfigured,
          twoFactorOptedOut,
          deviceTrusted,
        })
      },
    )
    .post(
      "/device-trust/revoke",
      describeRoute({
        summary: "Revoke device trust",
        description: "Clear the device trust cookie to require 2FA on next login.",
        operationId: "auth.deviceTrustRevoke",
        responses: {
          200: {
            description: "Device trust revoked",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.literal(true),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        // Clear device trust cookie by setting maxAge to 0
        setCookie(c, "opencode_device_trust", "", {
          path: "/",
          httpOnly: true,
          secure: c.req.url.startsWith("https"),
          sameSite: "Strict",
          maxAge: 0,
        })
        return c.json({ success: true as const })
      },
    )
    .get("/2fa/setup", async (c) => {
      // Require authenticated session
      const sessionId = getCookie(c, "opencode_session")
      if (!sessionId) {
        return c.redirect("/auth/login")
      }
      const session = UserSession.get(sessionId)
      if (!session) {
        return c.redirect("/auth/login")
      }

      // Check if 2FA is already configured
      const broker = new BrokerClient()
      const has2fa = await broker.check2fa(session.username, session.home ?? "")

      // Check if setup is required (from login redirect)
      const required = c.req.query("required") === "1"

      // Generate setup data
      const setupData = await generateTotpSetup(session.username)
      UserSession.setTwoFactorSetupSecret(sessionId, setupData.secret)

      let setupStatus: "pending_verification" | "already_configured" | "manual_required" = "pending_verification"
      let setupMessage: string | undefined = "We'll create your 2FA configuration after you verify your code."
      let setupCommand: string | undefined

      if (has2fa) {
        setupStatus = "already_configured"
        setupMessage = "We detected an existing 2FA configuration for this account."
      } else {
        const brokerAvailable = await broker.ping()
        if (!brokerAvailable) {
          setupStatus = "manual_required"
          setupMessage = "We couldn't reach the authentication service. Run the command below on the server."
          setupCommand = getGoogleAuthenticatorSetupCommand(setupData.secret)
        }
      }

      const uiDir = getUiDir()
      if (!uiDir) {
        return c.text("2FA setup UI is not configured. Build the app UI and set uiDir.", 500)
      }

      try {
        const template = await loadTwoFactorSetupTemplate(uiDir)
        return c.html(
          injectTwoFactorSetupBootstrap(template, {
            username: session.username,
            secret: setupData.secret,
            qrCodeSvg: setupData.qrCodeSvg,
            setupCommand,
            alreadyConfigured: setupStatus === "already_configured",
            required,
            setupStatus,
            setupMessage,
          }),
        )
      } catch (error) {
        log.error("Failed to load 2FA setup HTML", { error })
        return c.text("2FA setup UI is missing. Run the app build to generate 2fa-setup.html.", 500)
      }
    })
    .post("/2fa/verify", async (c) => {
      // Require authenticated session
      const sessionId = getCookie(c, "opencode_session")
      if (!sessionId) {
        return c.json({ error: "not_authenticated" }, 401)
      }
      const session = UserSession.get(sessionId)
      if (!session) {
        return c.json({ error: "not_authenticated" }, 401)
      }

      // Check CSRF
      const xrw = c.req.header("X-Requested-With")
      if (!xrw) {
        return c.json({ error: "csrf_missing", message: "CSRF token required" }, 400)
      }

      const body = await c.req.json()
      const { code } = body as { code?: string }

      if (!code || code.length < 6) {
        return c.json({ error: "invalid_code", message: "Code is required" }, 400)
      }

      const broker = new BrokerClient()

      // Check OTP server configuration first
      const otpConfig = await broker.checkOtpConfig()
      if (!otpConfig.configured) {
        // Return specific error based on what's misconfigured
        if (otpConfig.errorCode === "pam_module_not_installed") {
          return c.json(
            {
              error: "server_misconfigured",
              message:
                "Server configuration error: libpam-google-authenticator is not installed. " +
                "Install it with: Ubuntu/Debian: sudo apt install libpam-google-authenticator, " +
                "macOS: brew install google-authenticator-libpam",
              details: otpConfig,
            },
            500,
          )
        } else if (otpConfig.errorCode === "pam_service_not_configured") {
          return c.json(
            {
              error: "server_misconfigured",
              message:
                `Server configuration error: PAM service file missing at ${otpConfig.pamServicePath}. ` +
                'Create it with: echo "auth required pam_google_authenticator.so nullok" | sudo tee ' +
                otpConfig.pamServicePath,
              details: otpConfig,
            },
            500,
          )
        } else if (otpConfig.errorCode === "broker_unavailable") {
          return c.json(
            {
              error: "server_error",
              message: "Authentication service unavailable. Please try again later.",
            },
            503,
          )
        } else {
          return c.json(
            {
              error: "server_misconfigured",
              message: "Server configuration error: OTP validation is not properly configured.",
              details: otpConfig,
            },
            500,
          )
        }
      }

      // Log if service file was auto-created
      if (otpConfig.serviceAutoCreated) {
        log.info("PAM service file auto-created", { path: otpConfig.pamServicePath })
      }

      const setupSecret = session.twoFactorSetupSecret
      if (!setupSecret) {
        return c.json(
          {
            error: "setup_missing",
            message: "2FA setup session expired. Please restart setup.",
          },
          400,
        )
      }

      if (!verifyTotpCode(setupSecret, code)) {
        return c.json(
          {
            error: "invalid_code",
            message:
              "Invalid verification code. Make sure your authenticator is set up and the code matches the QR code you scanned.",
          },
          401,
        )
      }

      const setupResult = await broker.setupOtp(sessionId, setupSecret)
      if (setupResult.errorCode && !setupResult.written && !setupResult.alreadyConfigured) {
        return c.json(
          {
            error: "setup_failed",
            message: "Unable to create your 2FA configuration. Please try again.",
            details: setupResult,
          },
          500,
        )
      }

      // Clear twoFactorPending flag now that 2FA is configured
      UserSession.clearTwoFactorPending(sessionId)
      UserSession.clearTwoFactorSetupSecret(sessionId)
      await setTwoFactorPreference(session.username, { skipSetup: false })

      return c.json({ success: true })
    })
    .post("/2fa/skip", async (c) => {
      // Require authenticated session
      const sessionId = getCookie(c, "opencode_session")
      if (!sessionId) {
        return c.json({ error: "not_authenticated" }, 401)
      }
      const session = UserSession.get(sessionId)
      if (!session) {
        return c.json({ error: "not_authenticated" }, 401)
      }

      // Check CSRF
      const xrw = c.req.header("X-Requested-With")
      if (!xrw) {
        return c.json({ error: "csrf_missing" }, 400)
      }

      // Check if 2FA is required - if so, cannot skip
      const authConfig = ServerAuth.get()
      if (authConfig.twoFactorRequired) {
        return c.json(
          { error: "2fa_required", message: "Two-factor authentication is required and cannot be skipped" },
          403,
        )
      }

      // Clear setup state so user can access the app
      UserSession.clearTwoFactorPending(sessionId)
      UserSession.clearTwoFactorSetupSecret(sessionId)

      return c.json({ success: true })
    })
    .post("/2fa/reset", async (c) => {
      // Require authenticated session
      const sessionId = getCookie(c, "opencode_session")
      if (!sessionId) {
        return c.json({ error: "not_authenticated" }, 401)
      }
      const session = UserSession.get(sessionId)
      if (!session) {
        return c.json({ error: "not_authenticated" }, 401)
      }

      // Check CSRF
      const xrw = c.req.header("X-Requested-With")
      if (!xrw) {
        return c.json({ error: "csrf_missing", message: "CSRF token required" }, 400)
      }
      const csrfToken = c.req.header("X-CSRF-Token")
      if (!csrfToken || !validateCSRFToken(csrfToken, sessionId, getCSRFSecret())) {
        return c.json({ error: "csrf_invalid", message: "Invalid CSRF token" }, 403)
      }

      const broker = new BrokerClient()
      let result = await broker.removeOtp(sessionId)
      if (result.errorCode === "session not found") {
        const registered = await ensureBrokerSession(sessionId, session)
        if (registered) {
          result = await broker.removeOtp(sessionId)
        }
      }

      if (result.errorCode && !result.removed && !result.alreadyMissing) {
        return c.json({ error: "reset_failed", message: "Failed to reset 2FA", details: result }, 500)
      }

      await setTwoFactorPreference(session.username, { skipSetup: false })

      return c.json({
        success: true as const,
        removed: result.removed,
        alreadyMissing: result.alreadyMissing,
      })
    })
    .post("/2fa/disable", async (c) => {
      // Require authenticated session
      const sessionId = getCookie(c, "opencode_session")
      if (!sessionId) {
        return c.json({ error: "not_authenticated" }, 401)
      }
      const session = UserSession.get(sessionId)
      if (!session) {
        return c.json({ error: "not_authenticated" }, 401)
      }

      // Check CSRF
      const xrw = c.req.header("X-Requested-With")
      if (!xrw) {
        return c.json({ error: "csrf_missing", message: "CSRF token required" }, 400)
      }
      const csrfToken = c.req.header("X-CSRF-Token")
      if (!csrfToken || !validateCSRFToken(csrfToken, sessionId, getCSRFSecret())) {
        return c.json({ error: "csrf_invalid", message: "Invalid CSRF token" }, 403)
      }

      const authConfig = ServerAuth.get()
      if (authConfig.twoFactorRequired) {
        return c.json(
          { error: "2fa_required", message: "Two-factor authentication is required and cannot be disabled" },
          403,
        )
      }

      const broker = new BrokerClient()
      let result = await broker.removeOtp(sessionId)
      if (result.errorCode === "session not found") {
        const registered = await ensureBrokerSession(sessionId, session)
        if (registered) {
          result = await broker.removeOtp(sessionId)
        }
      }

      if (result.errorCode && !result.removed && !result.alreadyMissing) {
        return c.json({ error: "disable_failed", message: "Failed to disable 2FA", details: result }, 500)
      }

      UserSession.clearTwoFactorPending(sessionId)
      UserSession.clearTwoFactorSetupSecret(sessionId)
      await setTwoFactorPreference(session.username, { skipSetup: true })

      return c.json({
        success: true as const,
        removed: result.removed,
        alreadyMissing: result.alreadyMissing,
      })
    })
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
        clearCSRFCookie(c)
        // Note: Device trust cookie is NOT cleared on regular logout
        // This allows "Remember this device" to persist across sessions
        // Use "Forget this device" or "Logout all" to clear device trust
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
        clearCSRFCookie(c)
        // Also clear device trust cookie on logout all
        setCookie(c, "opencode_device_trust", "", {
          path: "/",
          httpOnly: true,
          secure: c.req.url.startsWith("https"),
          sameSite: "Strict",
          maxAge: 0,
        })
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

        let csrfToken = getCookie(c, CSRF_COOKIE_NAME)
        const hasValidCsrf = csrfToken ? validateCSRFToken(csrfToken, session.id, getCSRFSecret()) : false
        if (!hasValidCsrf) {
          setCSRFCookie(c, session.id)
          csrfToken = getCookie(c, CSRF_COOKIE_NAME)
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
          csrfToken,
        })
      },
    ),
)
