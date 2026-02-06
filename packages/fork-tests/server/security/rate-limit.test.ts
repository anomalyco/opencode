import { describe, it, expect, beforeEach } from "bun:test"
import { Hono } from "hono"
import { createLoginRateLimiter, getClientIP } from "../../../../opencode/src/server/security/rate-limit"

describe("rate-limit", () => {
  describe("getClientIP", () => {
    it("extracts IP from X-Forwarded-For header", async () => {
      const app = new Hono()
      app.get("/test", (c) => {
        const ip = getClientIP(c)
        return c.json({ ip })
      })

      const req = new Request("http://localhost/test", {
        headers: {
          "X-Forwarded-For": "192.168.1.1",
        },
      })
      const res = await app.fetch(req)
      const data = await res.json()

      expect(data.ip).toBe("192.168.1.1")
    })

    it("uses first IP when X-Forwarded-For has multiple IPs", async () => {
      const app = new Hono()
      app.get("/test", (c) => {
        const ip = getClientIP(c)
        return c.json({ ip })
      })

      const req = new Request("http://localhost/test", {
        headers: {
          "X-Forwarded-For": "192.168.1.1, 10.0.0.1, 172.16.0.1",
        },
      })
      const res = await app.fetch(req)
      const data = await res.json()

      expect(data.ip).toBe("192.168.1.1")
    })

    it("falls back to X-Real-IP when X-Forwarded-For not present", async () => {
      const app = new Hono()
      app.get("/test", (c) => {
        const ip = getClientIP(c)
        return c.json({ ip })
      })

      const req = new Request("http://localhost/test", {
        headers: {
          "X-Real-IP": "10.0.0.1",
        },
      })
      const res = await app.fetch(req)
      const data = await res.json()

      expect(data.ip).toBe("10.0.0.1")
    })

    it("returns 'unknown' when no headers present", async () => {
      const app = new Hono()
      app.get("/test", (c) => {
        const ip = getClientIP(c)
        return c.json({ ip })
      })

      const req = new Request("http://localhost/test")
      const res = await app.fetch(req)
      const data = await res.json()

      expect(data.ip).toBe("unknown")
    })

    it("prefers X-Forwarded-For over X-Real-IP", async () => {
      const app = new Hono()
      app.get("/test", (c) => {
        const ip = getClientIP(c)
        return c.json({ ip })
      })

      const req = new Request("http://localhost/test", {
        headers: {
          "X-Forwarded-For": "192.168.1.1",
          "X-Real-IP": "10.0.0.1",
        },
      })
      const res = await app.fetch(req)
      const data = await res.json()

      expect(data.ip).toBe("192.168.1.1")
    })
  })

  describe("createLoginRateLimiter", () => {
    it("returns a middleware function", () => {
      const limiter = createLoginRateLimiter()
      expect(typeof limiter).toBe("function")
    })

    it("allows requests under limit", async () => {
      const app = new Hono()
      const limiter = createLoginRateLimiter({ windowMs: 1000, limit: 3 })

      app.post("/login", limiter, (c) => c.json({ error: "invalid_credentials" }, 401))

      // Make 3 requests - all should succeed
      for (let i = 0; i < 3; i++) {
        const req = new Request("http://localhost/login", {
          method: "POST",
          headers: {
            "X-Forwarded-For": "192.168.1.1",
          },
        })
        const res = await app.fetch(req)
        expect(res.status).toBe(401)
      }
    })

    it("blocks requests over limit with 429", async () => {
      const app = new Hono()
      const limiter = createLoginRateLimiter({ windowMs: 1000, limit: 2 })

      app.post("/login", limiter, (c) => c.json({ error: "invalid_credentials" }, 401))

      const headers = { "X-Forwarded-For": "192.168.1.1" }

      // First 2 requests should succeed
      for (let i = 0; i < 2; i++) {
        const req = new Request("http://localhost/login", {
          method: "POST",
          headers,
        })
        const res = await app.fetch(req)
        expect(res.status).toBe(401)
      }

      // 3rd request should be rate limited
      const req3 = new Request("http://localhost/login", {
        method: "POST",
        headers,
      })
      const res3 = await app.fetch(req3)
      expect(res3.status).toBe(429)

      const data = await res3.json()
      expect(data.error).toBe("rate_limit_exceeded")
      expect(data.message).toContain("Too many login attempts")
    })

    it("includes Retry-After header on 429", async () => {
      const app = new Hono()
      const limiter = createLoginRateLimiter({ windowMs: 1000, limit: 1 })

      app.post("/login", limiter, (c) => c.json({ error: "invalid_credentials" }, 401))

      const headers = { "X-Forwarded-For": "192.168.1.1" }

      // First request succeeds
      await app.fetch(new Request("http://localhost/login", { method: "POST", headers }))

      // Second request is rate limited
      const res = await app.fetch(new Request("http://localhost/login", { method: "POST", headers }))
      expect(res.status).toBe(429)

      const retryAfter = res.headers.get("Retry-After")
      expect(retryAfter).toBeTruthy()
      expect(Number(retryAfter)).toBeGreaterThan(0)
    })

    it("different IPs have independent limits", async () => {
      const app = new Hono()
      const limiter = createLoginRateLimiter({ windowMs: 1000, limit: 1 })

      app.post("/login", limiter, (c) => c.json({ error: "invalid_credentials" }, 401))

      // IP 1: First request succeeds, second is rate limited
      const ip1Headers = { "X-Forwarded-For": "192.168.1.1" }
      const res1a = await app.fetch(new Request("http://localhost/login", { method: "POST", headers: ip1Headers }))
      expect(res1a.status).toBe(401)

      const res1b = await app.fetch(new Request("http://localhost/login", { method: "POST", headers: ip1Headers }))
      expect(res1b.status).toBe(429)

      // IP 2: First request still succeeds (independent limit)
      const ip2Headers = { "X-Forwarded-For": "10.0.0.1" }
      const res2a = await app.fetch(new Request("http://localhost/login", { method: "POST", headers: ip2Headers }))
      expect(res2a.status).toBe(401)
    })

    it("resets after window expires", async () => {
      const app = new Hono()
      const limiter = createLoginRateLimiter({ windowMs: 100, limit: 1 })

      app.post("/login", limiter, (c) => c.json({ error: "invalid_credentials" }, 401))

      const headers = { "X-Forwarded-For": "192.168.1.1" }

      // First request succeeds
      const res1 = await app.fetch(new Request("http://localhost/login", { method: "POST", headers }))
      expect(res1.status).toBe(401)

      // Second request is rate limited
      const res2 = await app.fetch(new Request("http://localhost/login", { method: "POST", headers }))
      expect(res2.status).toBe(429)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Third request succeeds (window reset)
      const res3 = await app.fetch(new Request("http://localhost/login", { method: "POST", headers }))
      expect(res3.status).toBe(401)
    })

    it("uses default config when not provided", () => {
      const limiter = createLoginRateLimiter()
      expect(typeof limiter).toBe("function")
      // Default: 15 minutes window, 5 attempts
      // Can't easily test timing without mocking, but verify it creates successfully
    })

    it("respects custom config values", async () => {
      const app = new Hono()
      const limiter = createLoginRateLimiter({ windowMs: 1000, limit: 10 })

      app.post("/login", limiter, (c) => c.json({ error: "invalid_credentials" }, 401))

      const headers = { "X-Forwarded-For": "192.168.1.1" }

      // Should allow 10 requests
      for (let i = 0; i < 10; i++) {
        const res = await app.fetch(new Request("http://localhost/login", { method: "POST", headers }))
        expect(res.status).toBe(401)
      }

      // 11th should be rate limited
      const res = await app.fetch(new Request("http://localhost/login", { method: "POST", headers }))
      expect(res.status).toBe(429)
    })
  })
})
