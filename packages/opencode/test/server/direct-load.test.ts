import { describe, test, expect } from "bun:test"
import { Server } from "../../src/server/server"

describe("direct-load mode CORS", () => {
  test("preflight request from CDN origin returns CORS headers", async () => {
    const opts = { port: 0, hostname: "127.0.0.1", cors: ["https://example-cdn.github.io"] }
    const server = await Server.listen(opts)

    try {
      const res = await fetch(`http://localhost:${server.port}/session`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://example-cdn.github.io",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Authorization",
        },
      })

      expect(res.status).toBe(204)
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example-cdn.github.io")
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET")
      expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization")
    } finally {
      await server.stop()
    }
  })

  test("actual request from CDN origin returns CORS headers", async () => {
    const opts = { port: 0, hostname: "127.0.0.1", cors: ["https://example-cdn.github.io"] }
    const server = await Server.listen(opts)

    try {
      const res = await fetch(`http://localhost:${server.port}/session`, {
        method: "GET",
        headers: {
          Origin: "https://example-cdn.github.io",
        },
      })

      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example-cdn.github.io")
    } finally {
      await server.stop()
    }
  })

  test("request from unknown origin does NOT get CORS headers", async () => {
    const opts = { port: 0, hostname: "127.0.0.1", cors: ["https://example-cdn.github.io"] }
    const server = await Server.listen(opts)

    try {
      const res = await fetch(`http://localhost:${server.port}/session`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example.com",
          "Access-Control-Request-Method": "GET",
        },
      })

      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    } finally {
      await server.stop()
    }
  })

  test("SSE event stream from CDN origin gets CORS headers", async () => {
    const opts = { port: 0, hostname: "127.0.0.1", cors: ["https://example-cdn.github.io"] }
    const server = await Server.listen(opts)

    try {
      const controller = new AbortController()
      const res = await fetch(`http://localhost:${server.port}/global/event`, {
        method: "GET",
        headers: {
          Origin: "https://example-cdn.github.io",
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      })

      // Abort immediately after getting headers
      controller.abort()

      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example-cdn.github.io")
      expect(res.headers.get("Content-Type")).toContain("text/event-stream")
    } finally {
      await server.stop()
    }
  })
})
