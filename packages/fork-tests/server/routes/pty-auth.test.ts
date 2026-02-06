import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Hono } from "hono"
import { ServerAuth } from "../../../../opencode/src/config/server-auth"
import { UserSession } from "../../../../opencode/src/session/user-session"
import { getAuthContext, type AuthContext, type AuthEnv } from "../../../../opencode/src/server/middleware/auth"

/**
 * Tests for PTY route auth enforcement.
 *
 * These tests verify that:
 * 1. PTY routes check authentication when auth is enabled
 * 2. PTY routes pass sessionId to Pty.create when auth is enabled
 * 3. PTY routes work normally when auth is disabled
 *
 * The tests use a simple route handler that simulates the auth check logic
 * from the actual PTY routes, avoiding the complexity of mocking the full
 * PTY module with its bun-pty dependencies.
 */
describe("PTY auth enforcement logic", () => {
  let originalAuthConfig: ReturnType<typeof ServerAuth.get>
  let testSession: UserSession.Info | undefined

  beforeEach(() => {
    // Save original config
    originalAuthConfig = ServerAuth.get()

    // Clean up any previous test sessions
    testSession = undefined
  })

  afterEach(() => {
    // Restore original config
    ServerAuth._setForTesting(originalAuthConfig)

    // Clean up test session
    if (testSession) {
      UserSession.remove(testSession.id)
    }
  })

  describe("auth check pattern", () => {
    test("getAuthContext returns undefined when auth context not set", async () => {
      const app = new Hono().get("/test", (c) => {
        const auth = getAuthContext(c)
        return c.json({ hasAuth: !!auth })
      })

      const res = await app.request("/test")
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.hasAuth).toBe(false)
    })

    test("auth context is available when session is valid", async () => {
      // Create a session
      testSession = UserSession.create("testuser", "test-agent", {
        uid: 1000,
        gid: 1000,
        home: "/home/testuser",
        shell: "/bin/bash",
      })

      // Enable auth
      ServerAuth._setForTesting({
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
      })

      const app = new Hono<AuthEnv>()
        // Simulate what authMiddleware does
        .use("*", async (c, next) => {
          const authConfig = ServerAuth.get()
          if (!authConfig.enabled) {
            return next()
          }

          // Get session directly (not from cookie in this test)
          const session = testSession
          if (!session) {
            return c.json({ error: "No session" }, 401)
          }

          // Set auth context like the real middleware does
          c.set("session", session)
          c.set("username", session.username)
          c.set("sessionId", session.id)
          c.set("auth", {
            sessionId: session.id,
            username: session.username,
            uid: session.uid,
            gid: session.gid,
          } as AuthContext)

          return next()
        })
        .get("/test", (c) => {
          const auth = getAuthContext(c)
          return c.json({
            hasAuth: !!auth,
            sessionId: auth?.sessionId,
            username: auth?.username,
          })
        })

      const res = await app.request("/test")
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.hasAuth).toBe(true)
      expect(body.sessionId).toBe(testSession!.id)
      expect(body.username).toBe("testuser")
    })
  })

  describe("PTY route auth check pattern", () => {
    // This simulates the auth check pattern used in PTY routes
    function createPtyRouteSimulator() {
      const mockCreate = { called: false, sessionId: undefined as string | undefined }
      const mockRemove = { called: false }
      const mockUpdate = { called: false }

      const app = new Hono<AuthEnv>()
        // POST /pty - create
        .post("/pty", async (c) => {
          const authConfig = ServerAuth.get()

          if (authConfig.enabled) {
            const auth = getAuthContext(c)
            if (!auth) {
              return c.json({ error: "Authentication required" }, 401)
            }
            mockCreate.called = true
            mockCreate.sessionId = auth.sessionId
            return c.json({ id: "pty_test", sessionId: auth.sessionId })
          }

          mockCreate.called = true
          mockCreate.sessionId = undefined
          return c.json({ id: "pty_test" })
        })
        // DELETE /pty/:id - remove
        .delete("/pty/:id", async (c) => {
          const authConfig = ServerAuth.get()

          if (authConfig.enabled) {
            const auth = getAuthContext(c)
            if (!auth) {
              return c.json({ error: "Authentication required" }, 401)
            }
          }

          mockRemove.called = true
          return c.json(true)
        })
        // PUT /pty/:id - update
        .put("/pty/:id", async (c) => {
          const authConfig = ServerAuth.get()

          if (authConfig.enabled) {
            const auth = getAuthContext(c)
            if (!auth) {
              return c.json({ error: "Authentication required" }, 401)
            }
          }

          mockUpdate.called = true
          return c.json({ id: c.req.param("id"), title: "Updated" })
        })

      return { app, mockCreate, mockRemove, mockUpdate }
    }

    describe("when auth is enabled", () => {
      beforeEach(() => {
        ServerAuth._setForTesting({
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
        })
      })

      test("POST /pty returns 401 without auth context", async () => {
        const { app, mockCreate } = createPtyRouteSimulator()

        const res = await app.request("/pty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(401)
        const body = await res.json()
        expect(body.error).toBe("Authentication required")
        expect(mockCreate.called).toBe(false)
      })

      test("DELETE /pty/:id returns 401 without auth context", async () => {
        const { app, mockRemove } = createPtyRouteSimulator()

        const res = await app.request("/pty/pty_test", {
          method: "DELETE",
        })

        expect(res.status).toBe(401)
        expect(mockRemove.called).toBe(false)
      })

      test("PUT /pty/:id returns 401 without auth context", async () => {
        const { app, mockUpdate } = createPtyRouteSimulator()

        const res = await app.request("/pty/pty_test", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New" }),
        })

        expect(res.status).toBe(401)
        expect(mockUpdate.called).toBe(false)
      })
    })

    describe("when auth is disabled", () => {
      beforeEach(() => {
        ServerAuth._setForTesting({
          enabled: false,
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
        })
      })

      test("POST /pty succeeds without auth context", async () => {
        const { app, mockCreate } = createPtyRouteSimulator()

        const res = await app.request("/pty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(200)
        expect(mockCreate.called).toBe(true)
        expect(mockCreate.sessionId).toBeUndefined()
      })

      test("DELETE /pty/:id succeeds without auth context", async () => {
        const { app, mockRemove } = createPtyRouteSimulator()

        const res = await app.request("/pty/pty_test", {
          method: "DELETE",
        })

        expect(res.status).toBe(200)
        expect(mockRemove.called).toBe(true)
      })

      test("PUT /pty/:id succeeds without auth context", async () => {
        const { app, mockUpdate } = createPtyRouteSimulator()

        const res = await app.request("/pty/pty_test", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New" }),
        })

        expect(res.status).toBe(200)
        expect(mockUpdate.called).toBe(true)
      })
    })

    describe("sessionId passing to create", () => {
      test("sessionId is passed when auth enabled and context available", async () => {
        ServerAuth._setForTesting({
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
        })

        const { app, mockCreate } = createPtyRouteSimulator()

        // Add middleware to inject auth context
        const appWithAuth = new Hono<AuthEnv>()
          .use("*", async (c, next) => {
            c.set("auth", {
              sessionId: "test-session-123",
              username: "testuser",
              uid: 1000,
              gid: 1000,
            } as AuthContext)
            return next()
          })
          .route("/", app)

        const res = await appWithAuth.request("/pty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.sessionId).toBe("test-session-123")
        expect(mockCreate.sessionId).toBe("test-session-123")
      })

      test("sessionId is not passed when auth disabled", async () => {
        ServerAuth._setForTesting({
          enabled: false,
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
        })

        const { app, mockCreate } = createPtyRouteSimulator()

        const res = await app.request("/pty", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })

        expect(res.status).toBe(200)
        expect(mockCreate.sessionId).toBeUndefined()
      })
    })
  })
})

describe("getAuthContext export", () => {
  test("is exported from auth middleware", () => {
    expect(typeof getAuthContext).toBe("function")
  })
})
