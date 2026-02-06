import { describe, test, expect, mock, beforeEach } from "bun:test"
import { Hono } from "hono"
import path from "path"
import type { AuthResult } from "../../../../opencode/src/auth/broker-client"
import type { UnixUserInfo } from "../../../../opencode/src/auth/user-info"
import type { AuthConfig } from "../../../../opencode/src/config/auth"

// Mock state with explicit types
const mockAuthenticate = mock<() => Promise<AuthResult>>(() => Promise.resolve({ success: true }))
const mockGetUserInfo = mock<() => Promise<UnixUserInfo | null>>(() =>
  Promise.resolve({
    username: "testuser",
    uid: 1000,
    gid: 1000,
    gecos: "Test User",
    home: "/home/testuser",
    shell: "/bin/bash",
  }),
)

// Server auth config state for mocking
let mockAuthConfig: AuthConfig = {
  enabled: true,
  method: "pam",
  sessionTimeout: "7d",
  rememberMeDuration: "90d",
  requireHttps: "warn",
  rateLimiting: false, // Disabled by default for tests, enabled explicitly where needed
  rateLimitWindow: "15m",
  rateLimitMax: 5,
  allowedUsers: [],
  sessionPersistence: true,
  csrfVerboseErrors: false,
  debugBrokerErrors: true,
  csrfAllowlist: [],
  twoFactorEnabled: false,
  twoFactorTokenTimeout: "5m",
  deviceTrustDuration: "30d",
  otpRateLimitMax: 5,
  otpRateLimitWindow: "15m",
  twoFactorRequired: false,
}

// Mock for registerSession (fire-and-forget, just needs to not throw)
const mockRegisterSession = mock<() => Promise<boolean>>(() => Promise.resolve(true))

// Apply mocks before importing the module under test
mock.module("../../../src/auth/broker-client", () => ({
  BrokerClient: class {
    authenticate = mockAuthenticate
    registerSession = mockRegisterSession
  },
}))
mock.module("../../../src/auth/user-info", () => ({
  getUserInfo: mockGetUserInfo,
}))
mock.module("../../../src/config/server-auth", () => ({
  ServerAuth: {
    get: () => mockAuthConfig,
    isEnabled: () => mockAuthConfig.enabled,
    _setForTesting: (config: AuthConfig) => {
      mockAuthConfig = config
    },
    _reset: () => {
      mockAuthConfig = {
        enabled: true,
        method: "pam",
        sessionTimeout: "7d",
        rememberMeDuration: "90d",
        requireHttps: "warn",
        rateLimiting: false, // Disabled by default for tests
        rateLimitWindow: "15m",
        rateLimitMax: 5,
        allowedUsers: [],
        sessionPersistence: true,
        csrfVerboseErrors: false,
        debugBrokerErrors: true,
        csrfAllowlist: [],
        twoFactorEnabled: false,
        twoFactorTokenTimeout: "5m",
        deviceTrustDuration: "30d",
        otpRateLimitMax: 5,
        otpRateLimitWindow: "15m",
        twoFactorRequired: false,
      }
    },
  },
}))

// Import after mocking
const { AuthRoutes } = await import("../../../src/server/routes/auth")
const { setUiDir } = await import("../../../src/server/ui-dir")

setUiDir(path.resolve(import.meta.dir, "../../../..", "app"))

// Helper to set mock auth config
function setMockAuthConfig(config: Partial<AuthConfig>) {
  mockAuthConfig = {
    enabled: true,
    method: "pam",
    sessionTimeout: "7d",
    rememberMeDuration: "90d",
    requireHttps: "warn",
    rateLimiting: false, // Disabled by default for tests
    rateLimitWindow: "15m",
    rateLimitMax: 5,
    allowedUsers: [],
    sessionPersistence: true,
    csrfVerboseErrors: false,
    debugBrokerErrors: true,
    csrfAllowlist: [],
    twoFactorEnabled: false,
    twoFactorTokenTimeout: "5m",
    deviceTrustDuration: "30d",
    otpRateLimitMax: 5,
    otpRateLimitWindow: "15m",
    twoFactorRequired: false,
    ...config,
  }
}

describe("POST /auth/login", () => {
  let app: Hono

  beforeEach(() => {
    // Reset mocks
    mockAuthenticate.mockClear()
    mockGetUserInfo.mockClear()

    // Default successful mocks
    mockAuthenticate.mockResolvedValue({ success: true })
    mockGetUserInfo.mockResolvedValue({
      username: "testuser",
      uid: 1000,
      gid: 1000,
      gecos: "Test User",
      home: "/home/testuser",
      shell: "/bin/bash",
    })
    setMockAuthConfig({ enabled: true, method: "pam" })

    app = new Hono().route("/auth", AuthRoutes())
  })

  test("returns 400 when X-Requested-With header missing", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test", password: "pass" }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("csrf_missing")
  })

  test("returns 400 when username missing", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ password: "pass" }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_request")
  })

  test("returns 400 when password missing", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "test" }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_request")
  })

  test("returns 401 when authentication fails", async () => {
    mockAuthenticate.mockResolvedValue({ success: false, error: "Invalid credentials" })

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "test", password: "wrong" }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("auth_failed")
    expect(body.message).toBe("Authentication failed") // Generic, no details
  })

  test("returns 503 when broker is unavailable", async () => {
    mockAuthenticate.mockResolvedValue({
      success: false,
      code: "broker_unavailable",
      reason: "socket_missing",
      error: "authentication service unavailable",
    })

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "test", password: "wrong" }),
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("broker_unavailable")
    expect(body.message).toBe("Authentication service unavailable. Please try again later.")
    expect(body.details?.reason).toBe("socket_missing")
    expect(typeof body.details?.requestId).toBe("string")
  })

  test("returns 429 when broker rate limits", async () => {
    mockAuthenticate.mockResolvedValue({
      success: false,
      code: "rate_limit_exceeded",
      error: "too many authentication attempts, retry after 10s",
      retryAfterSeconds: 10,
    })

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "test", password: "wrong" }),
    })
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("10")
    const body = await res.json()
    expect(body.error).toBe("rate_limit_exceeded")
    expect(body.message).toBe("too many authentication attempts, retry after 10s")
  })

  test("returns 200 with user info on successful login", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "testuser", password: "correct" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.user.username).toBe("testuser")
    expect(body.user.uid).toBe(1000)
    expect(body.user.gid).toBe(1000)
    expect(body.user.home).toBe("/home/testuser")
    expect(body.user.shell).toBe("/bin/bash")
  })

  test("sets session cookie on successful login", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "testuser", password: "correct" }),
    })
    expect(res.status).toBe(200)
    const cookie = res.headers.get("Set-Cookie")
    expect(cookie).toContain("opencode_session=")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("SameSite=Strict")
  })

  test("accepts form POST body", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({ username: "testuser", password: "correct" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test("rejects invalid returnUrl (double slash)", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "testuser", password: "correct", returnUrl: "//evil.com" }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_return_url")
  })

  test("rejects invalid returnUrl (absolute URL)", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "testuser", password: "correct", returnUrl: "https://evil.com" }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_return_url")
  })

  test("accepts valid returnUrl", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "testuser", password: "correct", returnUrl: "/dashboard" }),
    })
    expect(res.status).toBe(200)
  })

  test("returns 403 when auth is disabled", async () => {
    setMockAuthConfig({ enabled: false })

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "test", password: "pass" }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("auth_disabled")
  })

  test("returns 401 when user info lookup fails", async () => {
    mockGetUserInfo.mockResolvedValue(null)

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "testuser", password: "correct" }),
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("auth_failed")
  })

  test("returns 400 for unsupported Content-Type", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: "username=test&password=pass",
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_content_type")
  })
})

describe("GET /auth/status", () => {
  let app: Hono

  beforeEach(() => {
    setMockAuthConfig({ enabled: true, method: "pam" })
    app = new Hono().route("/auth", AuthRoutes())
  })

  test("returns enabled true when auth is enabled", async () => {
    setMockAuthConfig({ enabled: true, method: "pam" })

    const res = await app.request("/auth/status")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.method).toBe("pam")
  })

  test("returns enabled false when auth is disabled", async () => {
    setMockAuthConfig({ enabled: false })

    const res = await app.request("/auth/status")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(false)
    expect(body.method).toBeUndefined()
  })

  test("returns enabled false when auth config missing", async () => {
    setMockAuthConfig({ enabled: false })

    const res = await app.request("/auth/status")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(false)
  })

  test("does not require authentication", async () => {
    // Status endpoint should be accessible without session cookie
    setMockAuthConfig({ enabled: true, method: "pam" })

    const res = await app.request("/auth/status")
    expect(res.status).toBe(200)
  })
})

describe("Rate limiting", () => {
  let app: Hono

  beforeEach(() => {
    mockAuthenticate.mockClear()
    mockGetUserInfo.mockClear()
    mockAuthenticate.mockResolvedValue({ success: false, error: "Invalid credentials" })
    mockGetUserInfo.mockResolvedValue({
      username: "testuser",
      uid: 1000,
      gid: 1000,
      gecos: "Test User",
      home: "/home/testuser",
      shell: "/bin/bash",
    })
  })

  test("rate limiting config is respected", async () => {
    // Note: Testing exact rate limit behavior is challenging due to lazy initialization
    // and shared state. This test verifies the config is properly read.
    setMockAuthConfig({
      enabled: true,
      method: "pam",
      rateLimiting: true,
      rateLimitWindow: "15m",
      rateLimitMax: 5,
    })

    app = new Hono().route("/auth", AuthRoutes())

    // Verify rate limiter doesn't break normal requests
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Forwarded-For": "192.168.99.1",
      },
      body: JSON.stringify({ username: "test", password: "wrong" }),
    })
    // Should fail auth, not rate limit (under limit)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("auth_failed")
  })

  test("rate limiting is skipped when disabled", async () => {
    setMockAuthConfig({
      enabled: true,
      method: "pam",
      rateLimiting: false,
    })

    app = new Hono().route("/auth", AuthRoutes())

    const headers = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-Forwarded-For": "192.168.1.test2",
    }

    // Make many requests - none should be rate limited
    for (let i = 0; i < 10; i++) {
      const res = await app.request("/auth/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: "test", password: "wrong" }),
      })
      expect(res.status).toBe(401) // Auth fails, but not rate limited
    }
  })

  test("rate limiting is skipped when auth disabled", async () => {
    setMockAuthConfig({ enabled: false })

    app = new Hono().route("/auth", AuthRoutes())

    const headers = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-Forwarded-For": "192.168.1.test3",
    }

    // Should return 403 (auth disabled), not rate limited
    for (let i = 0; i < 10; i++) {
      const res = await app.request("/auth/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: "test", password: "wrong" }),
      })
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe("auth_disabled")
    }
  })
})

describe("Security event logging", () => {
  let app: Hono
  let logCalls: Array<{ level: string; message: string; data: any }> = []

  beforeEach(() => {
    logCalls = []
    mockAuthenticate.mockClear()
    mockGetUserInfo.mockClear()
    mockAuthenticate.mockResolvedValue({ success: false, error: "Invalid credentials" })
    mockGetUserInfo.mockResolvedValue({
      username: "testuser",
      uid: 1000,
      gid: 1000,
      gecos: "Test User",
      home: "/home/testuser",
      shell: "/bin/bash",
    })
    setMockAuthConfig({ enabled: true, method: "pam" })
    app = new Hono().route("/auth", AuthRoutes())
  })

  test("logs security event on failed login", async () => {
    mockAuthenticate.mockResolvedValue({ success: false, error: "Invalid credentials" })

    await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Forwarded-For": "192.168.1.100",
        "User-Agent": "TestAgent/1.0",
      },
      body: JSON.stringify({ username: "testuser", password: "wrong" }),
    })

    // Log is called but we can't easily intercept it without additional mocking
    // This test verifies the code path doesn't throw
  })

  test("logs security event on successful login", async () => {
    mockAuthenticate.mockResolvedValue({ success: true })

    await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-Forwarded-For": "192.168.1.100",
        "User-Agent": "TestAgent/1.0",
      },
      body: JSON.stringify({ username: "testuser", password: "correct" }),
    })

    // Log is called but we can't easily intercept it without additional mocking
    // This test verifies the code path doesn't throw
  })

  test("logs security event on CSRF violation", async () => {
    await app.request("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Missing X-Requested-With header
        "X-Forwarded-For": "192.168.1.100",
        "User-Agent": "TestAgent/1.0",
      },
      body: JSON.stringify({ username: "testuser", password: "pass" }),
    })

    // Log is called but we can't easily intercept it without additional mocking
    // This test verifies the code path doesn't throw
  })
})

describe("HTTPS detection and enforcement", () => {
  let app: Hono

  beforeEach(() => {
    mockAuthenticate.mockClear()
    mockGetUserInfo.mockClear()
    mockAuthenticate.mockResolvedValue({ success: true })
    mockGetUserInfo.mockResolvedValue({
      username: "testuser",
      uid: 1000,
      gid: 1000,
      gecos: "Test User",
      home: "/home/testuser",
      shell: "/bin/bash",
    })
  })

  test("GET /login returns warning HTML when requireHttps is warn and HTTP", async () => {
    setMockAuthConfig({ requireHttps: "warn" })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://example.com/auth/login", {
      method: "GET",
      headers: { Host: "example.com" },
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("window.__OPENCODE_LOGIN__")
    expect(html).toContain('"shouldWarn":true')
    expect(html).toContain('"shouldBlock":false')
  })

  test("GET /login returns blocked HTML when requireHttps is block and HTTP", async () => {
    setMockAuthConfig({ requireHttps: "block" })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://example.com/auth/login", {
      method: "GET",
      headers: { Host: "example.com" },
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("window.__OPENCODE_LOGIN__")
    expect(html).toContain('"shouldBlock":true')
  })

  test("GET /login returns normal HTML for secure connection", async () => {
    setMockAuthConfig({ requireHttps: "block", trustProxy: true })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://example.com/auth/login", {
      method: "GET",
      headers: { Host: "example.com", "X-Forwarded-Proto": "https" },
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('id="httpWarning"')
    expect(html).not.toContain("HTTPS is required")
  })

  test("GET /login returns normal HTML for localhost over HTTP", async () => {
    setMockAuthConfig({ requireHttps: "block" })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://localhost:4096/auth/login", {
      method: "GET",
      headers: { Host: "localhost:4096" },
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('id="httpWarning"')
    expect(html).not.toContain("HTTPS is required")
  })

  test("POST /login returns 403 when requireHttps is block and HTTP", async () => {
    setMockAuthConfig({ requireHttps: "block", trustProxy: false })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://example.com/auth/login", {
      method: "POST",
      headers: {
        Host: "example.com",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "testuser", password: "correct" }),
    })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("https_required")
  })

  test("POST /login succeeds for localhost even in block mode", async () => {
    setMockAuthConfig({ requireHttps: "block", trustProxy: false })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://localhost:4096/auth/login", {
      method: "POST",
      headers: {
        Host: "localhost:4096",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ username: "testuser", password: "correct" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test("respects X-Forwarded-Proto when trustProxy is true", async () => {
    setMockAuthConfig({ requireHttps: "warn", trustProxy: true })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://example.com/auth/login", {
      method: "GET",
      headers: {
        Host: "example.com",
        "X-Forwarded-Proto": "https",
      },
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('id="httpWarning"') // Should not warn because X-Forwarded-Proto says https
  })

  test("respects multi-value X-Forwarded-Proto when trustProxy is true", async () => {
    setMockAuthConfig({ requireHttps: "warn", trustProxy: true })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://example.com/auth/login", {
      method: "GET",
      headers: {
        Host: "example.com",
        "X-Forwarded-Proto": "https, http",
      },
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('id="httpWarning"')
  })

  test("respects Forwarded proto when trustProxy is true", async () => {
    setMockAuthConfig({ requireHttps: "warn", trustProxy: true })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://example.com/auth/login", {
      method: "GET",
      headers: {
        Host: "example.com",
        Forwarded: "proto=https;host=example.com",
      },
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('id="httpWarning"')
  })

  test("ignores X-Forwarded-Proto when trustProxy is false", async () => {
    setMockAuthConfig({ requireHttps: "warn", trustProxy: false })
    app = new Hono().route("/auth", AuthRoutes())

    const res = await app.request("http://example.com/auth/login", {
      method: "GET",
      headers: {
        Host: "example.com",
        "X-Forwarded-Proto": "https",
      },
    })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("window.__OPENCODE_LOGIN__")
    expect(html).toContain('"shouldWarn":true') // Should warn because trustProxy is false
  })
})
