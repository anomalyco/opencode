import { describe, it, expect } from "bun:test"
import app from "./index.ts"

describe("Worker Custom Domain and Routing Tests", () => {
  describe("Domain Information Endpoint", () => {
    it("should return domain info for standard request", async () => {
      const req = new Request("http://localhost/domain-info", {
        method: "GET",
        headers: {
          Host: "localhost",
        },
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(200)
      expect(data.request.hostname).toBe("localhost")
      expect(data.request.path).toBe("/domain-info")
      expect(data.routing.isCustomDomain).toBe(false)
    })

    it("should detect custom domain via CF-Worker-Custom-Domain header", async () => {
      const req = new Request("http://localhost/domain-info", {
        method: "GET",
        headers: {
          Host: "api.example.com",
          "CF-Worker-Custom-Domain": "true",
        },
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(200)
      expect(data.routing.isCustomDomain).toBe(true)
      expect(data.routing.hostname).toBe("api.example.com")
    })
  })

  describe("Route Pattern Matching", () => {
    it("should match /api/* pattern", async () => {
      const req = new Request("http://localhost/api/test", {
        method: "GET",
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(200)
      expect(data.pattern).toBe("/api/*")
      expect(data.path).toBe("/api/test")
    })

    it("should match nested paths in /api/*", async () => {
      const req = new Request("http://localhost/api/v1/users/123", {
        method: "GET",
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(200)
      expect(data.path).toBe("/api/v1/users/123")
    })
  })

  describe("Validation Tests", () => {
    it("should validate and accept valid request", async () => {
      const req = new Request("http://localhost/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "Hello World" }),
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe("Hello World")
      expect(data.validated).toBe(true)
    })

    it("should reject invalid request", async () => {
      const req = new Request("http://localhost/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "" }),
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(400)
      expect(data.success).toBe(false)
      expect(data.errors).toBeDefined()
    })

    it("should reject missing message field", async () => {
      const req = new Request("http://localhost/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(400)
      expect(data.success).toBe(false)
    })
  })

  describe("Echo Endpoint", () => {
    it("should echo back request body", async () => {
      const testPayload = {
        test: "data",
        number: 123,
        nested: { value: "nested" },
      }

      const req = new Request("http://localhost/echo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testPayload),
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(200)
      expect(data.received).toEqual(testPayload)
      expect(data.timestamp).toBeDefined()
    })
  })

  describe("Health Check", () => {
    it("should return healthy status", async () => {
      const req = new Request("http://localhost/health", {
        method: "GET",
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(200)
      expect(data.status).toBe("healthy")
      expect(data.timestamp).toBeDefined()
    })
  })

  describe("404 Handling", () => {
    it("should return 404 for unknown routes", async () => {
      const req = new Request("http://localhost/nonexistent", {
        method: "GET",
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(404)
      expect(data.error).toBe("Not Found")
      expect(data.path).toBe("/nonexistent")
    })
  })

  describe("Multiple Domain Simulation", () => {
    it("should handle different hostnames correctly", async () => {
      const hostnames = ["api.example.com", "api.test.example.com", "api.staging.example.com", "api.prod.example.com"]

      for (const hostname of hostnames) {
        const req = new Request(`http://${hostname}/domain-info`, {
          method: "GET",
          headers: {
            Host: hostname,
            "CF-Worker-Custom-Domain": "true",
          },
        })

        const res = await app.fetch(req)
        const data = (await res.json()) as any

        expect(res.status).toBe(200)
        expect(data.routing.hostname).toBe(hostname)
        expect(data.routing.isCustomDomain).toBe(true)
      }
    })
  })

  describe("Header Propagation", () => {
    it("should preserve Cloudflare headers", async () => {
      const req = new Request("http://localhost/domain-info", {
        method: "GET",
        headers: {
          Host: "api.example.com",
          "CF-Connecting-IP": "1.2.3.4",
          "CF-Worker-Custom-Domain": "true",
          "CF-Ray": "test-ray-id",
          "CF-IPCountry": "US",
          "CF-Request-ID": "test-request-id",
        },
      })

      const res = await app.fetch(req)
      const data = (await res.json()) as any

      expect(res.status).toBe(200)
      expect(data.cloudflare.cf["CF-Connecting-IP"]).toBe("1.2.3.4")
      expect(data.cloudflare.cf["CF-Worker-Custom-Domain"]).toBe("true")
      expect(data.cloudflare.cf["CF-Ray"]).toBe("test-ray-id")
      expect(data.cloudflare.cf["CF-IPCountry"]).toBe("US")
      expect(data.cloudflare.cf["CF-Request-ID"]).toBe("test-request-id")
    })
  })
})
