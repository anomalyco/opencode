import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const app = Server.App()

describe("security headers", () => {
  test("responses include all security headers", async () => {
    const response = await app.request("/global/health")
    expect(response.status).toBe(200)
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(response.headers.get("X-Frame-Options")).toBe("DENY")
    expect(response.headers.get("X-XSS-Protection")).toBe("0")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
  })
})

describe("body size limit", () => {
  test("rejects requests with content-length over 10MB", async () => {
    const limit = 10 * 1024 * 1024
    const response = await app.request("/global/health", {
      method: "POST",
      headers: {
        "Content-Length": String(limit + 1),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ping: true }),
    })
    expect(response.status).toBe(413)
    const body = await response.json()
    expect(body.error).toInclude("too large")
  })

  test("allows requests under 10MB", async () => {
    const response = await app.request("/global/health", {
      method: "GET",
      headers: {
        "Content-Length": "128",
      },
    })
    expect(response.status).toBe(200)
  })

  test("allows requests without content-length header", async () => {
    const response = await app.request("/global/health")
    expect(response.status).toBe(200)
  })
})

describe("CORS", () => {
  test("allows localhost origins", async () => {
    const response = await app.request("/global/health", {
      headers: { Origin: "http://localhost:3000" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000")
  })

  test("allows 127.0.0.1 origins", async () => {
    const response = await app.request("/global/health", {
      headers: { Origin: "http://127.0.0.1:4096" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:4096")
  })

  test("allows tauri://localhost origin", async () => {
    const response = await app.request("/global/health", {
      headers: { Origin: "tauri://localhost" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("tauri://localhost")
  })

  test("allows http://tauri.localhost origin", async () => {
    const response = await app.request("/global/health", {
      headers: { Origin: "http://tauri.localhost" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://tauri.localhost")
  })

  test("allows *.opencode.ai origins over https", async () => {
    const response = await app.request("/global/health", {
      headers: { Origin: "https://app.opencode.ai" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.opencode.ai")
  })

  test("allows subdomain of opencode.ai over https", async () => {
    const response = await app.request("/global/health", {
      headers: { Origin: "https://dev.app.opencode.ai" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://dev.app.opencode.ai")
  })

  test("rejects disallowed origins", async () => {
    const response = await app.request("/global/health", {
      headers: { Origin: "https://evil.com" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  test("rejects opencode.ai over http", async () => {
    const response = await app.request("/global/health", {
      headers: { Origin: "http://app.opencode.ai" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  test("handles CORS preflight for allowed origin", async () => {
    const response = await app.request("/global/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    })
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173")
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeTruthy()
  })

  test("preflight for disallowed origin gets no CORS headers", async () => {
    const response = await app.request("/global/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.com",
        "Access-Control-Request-Method": "POST",
      },
    })
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})
