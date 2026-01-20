import { describe, test, expect, mock, beforeEach } from "bun:test"
import { Hono } from "hono"
import type { AuthResult } from "../../../src/auth/broker-client"
import type { UnixUserInfo } from "../../../src/auth/user-info"
import type { AuthConfig } from "../../../src/config/auth"

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
  rateLimiting: true,
  allowedUsers: [],
  sessionPersistence: true,
}

// Apply mocks before importing the module under test
mock.module("../../../src/auth/broker-client", () => ({
  BrokerClient: class {
    authenticate = mockAuthenticate
  },
}))
mock.module("../../../src/auth/user-info", () => ({
  getUserInfo: mockGetUserInfo,
}))
mock.module("../../../src/config/server-auth", () => ({
  ServerAuth: {
    get: () => mockAuthConfig,
    isEnabled: () => mockAuthConfig.enabled,
  },
}))

// Import after mocking
const { AuthRoutes } = await import("../../../src/server/routes/auth")

// Helper to set mock auth config
function setMockAuthConfig(config: Partial<AuthConfig>) {
  mockAuthConfig = {
    enabled: true,
    method: "pam",
    sessionTimeout: "7d",
    rememberMeDuration: "90d",
    requireHttps: "warn",
    rateLimiting: true,
    allowedUsers: [],
    sessionPersistence: true,
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
