import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as Log from "@opencode-ai/core/util/log"
import * as http from "node:http"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"

void Log.init({ print: false })

// Verifies the end-to-end behavior of the security middleware against a real
// HTTP listener. Unlike the unit tests in security.test.ts, this exercises
// the on-the-wire Host header (which fetch refuses to override but
// node:http will) and the actual rejection responses produced by the
// middleware chain.

let listener: Awaited<ReturnType<typeof Server.listen>>

beforeAll(async () => {
  await resetDatabase()
  listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
})

afterAll(async () => {
  await listener?.stop(true)
  await resetDatabase()
})

type RawResponse = { statusCode: number; headers: http.IncomingHttpHeaders; body: string }

// Sends a raw HTTP request, allowing the caller to override the on-the-wire
// Host header (used to simulate DNS-rebinding attacks). Also handles WebSocket
// upgrade responses (101 Switching Protocols) so the WS-Origin tests don't
// have to start a real WebSocket client.
function rawRequest(options: {
  path: string
  method?: string
  headers?: Record<string, string>
  timeoutMs?: number
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: listener.port,
      path: options.path,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      timeout: options.timeoutMs ?? 3000,
    })

    let settled = false
    const settle = (value: RawResponse) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const failWith = (err: unknown) => {
      if (settled) return
      settled = true
      reject(err)
    }

    req.on("response", (res) => {
      const chunks: Uint8Array[] = []
      res.on("data", (chunk) => chunks.push(new Uint8Array(Buffer.from(chunk))))
      res.on("end", () =>
        settle({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      )
    })

    // If the server accepted the upgrade, node:http emits "upgrade" instead
    // of "response" and we have to release the underlying socket ourselves.
    req.on("upgrade", (res, socket) => {
      settle({
        statusCode: res.statusCode ?? 101,
        headers: res.headers,
        body: "",
      })
      socket.destroy()
    })

    req.on("timeout", () => {
      req.destroy()
      failWith(new Error("rawRequest timed out"))
    })
    req.on("error", failWith)
    req.end()
  })
}

describe("server security: Host header validation", () => {
  test("accepts loopback Host", async () => {
    const response = await rawRequest({ path: "/global/health" })
    expect(response.statusCode).toBe(200)
  })

  test("accepts explicit 127.0.0.1 Host", async () => {
    const response = await rawRequest({
      path: "/global/health",
      headers: { host: `127.0.0.1:${listener.port}` },
    })
    expect(response.statusCode).toBe(200)
  })

  test("rejects DNS-rebound attacker Host (defends against rebinding)", async () => {
    // The browser thinks it's talking to attacker.example, which DNS-rebinds
    // to 127.0.0.1. Without Host validation, the server would treat the
    // request as same-origin with the attacker page.
    const response = await rawRequest({
      path: "/global/health",
      headers: { host: "attacker.example" },
    })
    expect(response.statusCode).toBe(421)
  })

  test("rejects unknown Host on every endpoint, including safe GETs", async () => {
    const response = await rawRequest({
      path: "/doc",
      headers: { host: "totally-not-localhost.example" },
    })
    expect(response.statusCode).toBe(421)
  })

  test("rejects unknown Host on shell-execution endpoint (the worst-case path)", async () => {
    // Even if an attacker can reach the shell route at all, Host validation
    // returns 421 before the request reaches any handler. This is the path
    // the original report flagged ("execute commands on the local system").
    const response = await rawRequest({
      method: "POST",
      path: "/session/whatever/shell",
      headers: { host: "attacker.example", "content-type": "application/json" },
    })
    expect(response.statusCode).toBe(421)
  })
})

describe("server security: CORS allowlist", () => {
  test("allows preflight from the OpenCode hosted UI origin", async () => {
    const response = await rawRequest({
      method: "OPTIONS",
      path: "/global/health",
      headers: {
        origin: "https://app.opencode.ai",
        "access-control-request-method": "GET",
      },
    })
    expect(response.headers["access-control-allow-origin"]).toBe("https://app.opencode.ai")
  })

  test("does not reflect arbitrary localhost origins", async () => {
    // The previous broad allowlist trusted any http://localhost:* origin,
    // which meant any other locally-running browser context could drive the
    // OpenCode API including shell-execution endpoints.
    const response = await rawRequest({
      method: "OPTIONS",
      path: "/global/health",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
      },
    })
    expect(response.headers["access-control-allow-origin"]).toBeUndefined()
  })

  test("does not reflect arbitrary opencode.ai subdomains", async () => {
    const response = await rawRequest({
      method: "OPTIONS",
      path: "/global/health",
      headers: {
        origin: "https://attacker.opencode.ai",
        "access-control-request-method": "POST",
      },
    })
    expect(response.headers["access-control-allow-origin"]).toBeUndefined()
  })

  test("does not reflect arbitrary external origins (the malicious-site case)", async () => {
    const response = await rawRequest({
      method: "OPTIONS",
      path: "/global/health",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
      },
    })
    expect(response.headers["access-control-allow-origin"]).toBeUndefined()
  })
})
