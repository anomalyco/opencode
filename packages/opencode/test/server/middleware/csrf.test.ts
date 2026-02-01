import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { Hono } from "hono"
import { csrfMiddleware, setCSRFCookie, clearCSRFCookie } from "../../../src/server/middleware/csrf"
import { getCookie } from "hono/cookie"
import { ServerAuth } from "../../../src/config/server-auth"
import type { AuthConfig } from "../../../src/config/auth"
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../../../src/server/security/csrf"

// Type for test context with sessionId variable
type TestEnv = { Variables: { sessionId: string } }

describe("CSRF middleware", () => {
  let app: Hono<TestEnv>

  // Mock ServerAuth.get() to return test config
  let mockAuthConfig: AuthConfig
  const originalGet = ServerAuth.get

  beforeEach(() => {
    // Reset app for each test
    app = new Hono<TestEnv>()

    // Default auth config: enabled with CSRF
    mockAuthConfig = {
      enabled: true,
      method: "pam" as const,
      sessionTimeout: "7d",
      rememberMeDuration: "90d",
      requireHttps: "warn" as const,
      rateLimiting: true,
      rateLimitWindow: "15m",
      rateLimitMax: 5,
      allowedUsers: [],
      sessionPersistence: true,
      csrfVerboseErrors: false,
      csrfAllowlist: [],
      twoFactorEnabled: false,
      twoFactorTokenTimeout: "5m",
      deviceTrustDuration: "30d",
      otpRateLimitMax: 5,
      otpRateLimitWindow: "15m",
      twoFactorRequired: false,
    }

    // Mock ServerAuth.get
    ServerAuth.get = mock(() => mockAuthConfig)
  })

  afterEach(() => {
    // Restore original
    ServerAuth.get = originalGet
  })

  describe("Safe methods (GET, HEAD, OPTIONS)", () => {
    it("allows GET requests without CSRF token", async () => {
      app.use(csrfMiddleware)
      app.get("/test", (c) => c.json({ success: true }))

      const res = await app.request("/test", { method: "GET" })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })

    it("allows HEAD requests without CSRF token", async () => {
      app.use(csrfMiddleware)
      app.all("/test", (c) => c.text(""))

      const res = await app.request("/test", { method: "HEAD" })

      expect(res.status).toBe(200)
    })

    it("allows OPTIONS requests without CSRF token", async () => {
      app.use(csrfMiddleware)
      app.all("/test", (c) => c.text(""))

      const res = await app.request("/test", { method: "OPTIONS" })

      expect(res.status).toBe(200)
    })
  })

  describe("Auth disabled", () => {
    it("allows POST requests when auth is disabled", async () => {
      mockAuthConfig.enabled = false

      app.use(csrfMiddleware)
      app.post("/test", (c) => c.json({ success: true }))

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test" }),
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })

  describe("Allowlist", () => {
    it("allows /auth/login without CSRF validation", async () => {
      app.use(csrfMiddleware)
      app.post("/auth/login", (c) => c.json({ success: true }))

      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "test", password: "test" }),
      })

      expect(res.status).toBe(200)
    })

    it("allows /auth/status without CSRF validation", async () => {
      app.use(csrfMiddleware)
      app.get("/auth/status", (c) => c.json({ enabled: true }))

      const res = await app.request("/auth/status", { method: "GET" })

      expect(res.status).toBe(200)
    })

    it("allows custom allowlist routes", async () => {
      mockAuthConfig.csrfAllowlist = ["/api/webhook"]

      app.use(csrfMiddleware)
      app.post("/api/webhook", (c) => c.json({ success: true }))

      const res = await app.request("/api/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "test" }),
      })

      expect(res.status).toBe(200)
    })
  })

  describe("CSRF validation", () => {
    it("returns 403 when CSRF cookie is missing", async () => {
      app.use((c, next) => {
        c.set("sessionId", "test-session")
        return next()
      })
      app.use(csrfMiddleware)
      app.post("/test", (c) => c.json({ success: true }))

      const res = await app.request("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test" }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe("csrf_required")
    })

    it("returns 403 when CSRF request token is missing", async () => {
      app.use((c, next) => {
        c.set("sessionId", "test-session")
        return next()
      })
      app.use(csrfMiddleware)
      app.post("/test", (c) => c.json({ success: true }))

      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${CSRF_COOKIE_NAME}=test-token`,
        },
        body: JSON.stringify({ data: "test" }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe("csrf_invalid")
    })

    it("returns 403 when tokens do not match", async () => {
      app.use((c, next) => {
        c.set("sessionId", "test-session")
        return next()
      })
      app.use(csrfMiddleware)
      app.post("/test", (c) => c.json({ success: true }))

      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${CSRF_COOKIE_NAME}=cookie-token`,
          [CSRF_HEADER_NAME]: "different-token",
        },
        body: JSON.stringify({ data: "test" }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe("csrf_invalid")
    })

    it("returns 403 when HMAC signature is invalid", async () => {
      app.use((c, next) => {
        c.set("sessionId", "test-session")
        return next()
      })
      app.use(csrfMiddleware)
      app.post("/test", (c) => c.json({ success: true }))

      // Token with matching cookie/header but invalid HMAC
      const invalidToken = "invalid-signature.random-value-here"

      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${CSRF_COOKIE_NAME}=${invalidToken}`,
          [CSRF_HEADER_NAME]: invalidToken,
        },
        body: JSON.stringify({ data: "test" }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe("csrf_invalid")
    })

    it("allows valid CSRF token from header", async () => {
      const sessionId = "test-session"

      // Simulate setting CSRF cookie via helper
      let csrfToken = ""
      app.use((c, next) => {
        c.set("sessionId", sessionId)
        setCSRFCookie(c, sessionId)
        // Extract token from response for testing
        const cookie = c.res.headers.get("Set-Cookie")
        if (cookie) {
          const match = cookie.match(/opencode_csrf=([^;]+)/)
          if (match) csrfToken = match[1]
        }
        return next()
      })
      app.use(csrfMiddleware)
      app.post("/test", (c) => c.json({ success: true }))

      // First request sets the cookie
      await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
          [CSRF_HEADER_NAME]: csrfToken,
        },
        body: JSON.stringify({ data: "test" }),
      })

      // Now make actual request with valid token
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
          [CSRF_HEADER_NAME]: csrfToken,
        },
        body: JSON.stringify({ data: "test" }),
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })

    it("allows valid CSRF token from body._csrf field", async () => {
      const sessionId = "test-session"

      let csrfToken = ""
      app.use((c, next) => {
        c.set("sessionId", sessionId)
        setCSRFCookie(c, sessionId)
        const cookie = c.res.headers.get("Set-Cookie")
        if (cookie) {
          const match = cookie.match(/opencode_csrf=([^;]+)/)
          if (match) csrfToken = match[1]
        }
        return next()
      })
      app.use(csrfMiddleware)
      app.post("/test", (c) => c.json({ success: true }))

      // First request sets cookie
      await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
        },
        body: JSON.stringify({ data: "test", _csrf: csrfToken }),
      })

      // Actual request with token in body
      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
        },
        body: JSON.stringify({ data: "test", _csrf: csrfToken }),
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })

    it("returns 403 when sessionId is missing from context", async () => {
      app.use(csrfMiddleware)
      app.post("/test", (c) => c.json({ success: true }))

      const res = await app.request("/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${CSRF_COOKIE_NAME}=token`,
          [CSRF_HEADER_NAME]: "token",
        },
        body: JSON.stringify({ data: "test" }),
      })

      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toBe("csrf_invalid")
    })
  })

  describe("setCSRFCookie", () => {
    it("sets CSRF cookie with correct attributes", async () => {
      const sessionId = "test-session"

      app.get("/test", (c) => {
        setCSRFCookie(c, sessionId)
        return c.json({ success: true })
      })

      const res = await app.request("/test")

      const setCookieHeader = res.headers.get("Set-Cookie")
      expect(setCookieHeader).toBeTruthy()
      expect(setCookieHeader).toContain(CSRF_COOKIE_NAME)
      expect(setCookieHeader).toContain("Path=/")
      expect(setCookieHeader).toContain("SameSite=Lax")
      // httpOnly should NOT be set (required for double-submit)
      expect(setCookieHeader).not.toContain("HttpOnly")
    })

    it("sets Secure flag on HTTPS", async () => {
      const sessionId = "test-session"

      app.get("/test", (c) => {
        setCSRFCookie(c, sessionId)
        return c.json({ success: true })
      })

      const res = await app.request("https://example.com/test")

      const setCookieHeader = res.headers.get("Set-Cookie")
      expect(setCookieHeader).toContain("Secure")
    })
  })

  describe("clearCSRFCookie", () => {
    it("clears CSRF cookie", async () => {
      app.get("/test", (c) => {
        clearCSRFCookie(c)
        return c.json({ success: true })
      })

      const res = await app.request("/test")

      const setCookieHeader = res.headers.get("Set-Cookie")
      expect(setCookieHeader).toBeTruthy()
      expect(setCookieHeader).toContain(CSRF_COOKIE_NAME)
      // Should have Max-Age=0 or Expires in past to delete
      expect(setCookieHeader).toMatch(/Max-Age=0|Expires=/)
    })
  })
})
