import { describe, test, expect, beforeEach, mock } from "bun:test"
import { Hono } from "hono"
import z from "zod"
import type { AuthConfig } from "../../../../opencode/src/config/auth"
import type { AuthContext, AuthEnv } from "../../../../opencode/src/server/middleware/auth"

const mockCreate = mock(async () => ({
  id: "pty-test",
  title: "Terminal 1",
  command: "bash",
  args: [],
  cwd: "/",
  status: "running",
  pid: 123,
}))

const mockRegisterSession = mock<() => Promise<boolean>>(() => Promise.resolve(true))

let mockAuthConfig: AuthConfig = {
  enabled: true,
  method: "pam",
  sessionTimeout: "7d",
  rememberMeDuration: "90d",
  requireHttps: "warn",
  rateLimiting: true,
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

mock.module("../../../src/pty", () => ({
  Pty: {
    Info: z.object({ id: z.string() }),
    CreateInput: z.object({ title: z.string().optional() }),
    UpdateInput: z.object({
      title: z.string().optional(),
      size: z
        .object({
          rows: z.number(),
          cols: z.number(),
        })
        .optional(),
    }),
    list: () => [],
    get: () => undefined,
    create: mockCreate,
    update: mock(async () => ({ id: "pty-test" })),
    remove: mock(async () => undefined),
    connect: mock(() => undefined),
  },
}))

mock.module("../../../src/auth/broker-client", () => ({
  BrokerClient: class {
    registerSession = mockRegisterSession
  },
}))

mock.module("../../../src/config/server-auth", () => ({
  ServerAuth: {
    get: () => mockAuthConfig,
    _setForTesting: (config: AuthConfig) => {
      mockAuthConfig = config
    },
  },
}))

import { PtyRoutes } from "../../../../opencode/src/server/routes/pty"

const createAuthApp = () => {
  const session = {
    id: "session-123",
    username: "testuser",
    uid: 1000,
    gid: 1000,
    home: "/home/testuser",
    shell: "/bin/bash",
  }

  const app = new Hono<AuthEnv>()
    .use("*", async (c, next) => {
      const auth: AuthContext = {
        sessionId: session.id,
        username: session.username,
        uid: session.uid,
        gid: session.gid,
      }
      c.set("auth", auth)
      c.set("session", session as AuthEnv["Variables"]["session"])
      return next()
    })
    .route("/pty", PtyRoutes())

  return app
}

describe("PTY broker error handling", () => {
  beforeEach(() => {
    mockAuthConfig = {
      enabled: true,
      method: "pam",
      sessionTimeout: "7d",
      rememberMeDuration: "90d",
      requireHttps: "warn",
      rateLimiting: true,
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

    mockCreate.mockClear()
    mockRegisterSession.mockClear()
  })

  test("returns 503 when broker session registration fails", async () => {
    mockRegisterSession.mockResolvedValueOnce(false)
    const app = createAuthApp()

    const res = await app.request("/pty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe("broker_unavailable")
    expect(mockCreate).not.toHaveBeenCalled()
  })

  test("maps broker session missing to 404", async () => {
    const error = new Error("session not found")
    ;(error as { code?: string }).code = "broker_session_not_found"
    mockCreate.mockRejectedValueOnce(error)
    const app = createAuthApp()

    const res = await app.request("/pty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe("broker_session_not_found")
  })

  test("falls back to local path when auth disabled", async () => {
    mockAuthConfig = { ...mockAuthConfig, enabled: false }
    const app = new Hono().route("/pty", PtyRoutes())

    const res = await app.request("/pty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
    expect(mockRegisterSession).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalled()
  })
})
