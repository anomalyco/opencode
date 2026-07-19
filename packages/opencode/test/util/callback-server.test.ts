import { describe, expect, test } from "bun:test"
import http from "node:http"
import { startCallbackServer, waitForCallback } from "../../src/util/callback-server"

// Helper: fires an HTTP GET at a local URL and returns the status code + body
async function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = ""
      res.on("data", (chunk) => (body += chunk))
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on("error", reject)
  })
}

describe("util.callback-server", () => {
  test("server binds on a real OS-assigned port > 0", async () => {
    const server = startCallbackServer("/cb")
    // listen is async; wait one tick for the port to be assigned
    await new Promise((r) => setTimeout(r, 20))
    expect(server.port).toBeGreaterThan(0)
    server.close()
  })

  test("serves HTML success page and resolves promise when callback path is hit", async () => {
    const server = startCallbackServer("/github-install-callback")
    await new Promise((r) => setTimeout(r, 20))

    const url = `http://127.0.0.1:${server.port}/github-install-callback`
    const { status, body } = await get(url)

    expect(status).toBe(200)
    expect(body).toContain("Authorized!")

    // promise must resolve now (with 500ms server delay — use a short extra wait)
    await expect(server.promise).resolves.toBeUndefined()
  })

  test("returns 404 for unknown paths and does NOT resolve the promise", async () => {
    const server = startCallbackServer("/github-install-callback")
    await new Promise((r) => setTimeout(r, 20))

    const { status } = await get(`http://127.0.0.1:${server.port}/wrong-path`)
    expect(status).toBe(404)

    // promise should still be pending — race it against a short timeout
    let resolved = false
    await Promise.race([
      server.promise.then(() => { resolved = true }),
      new Promise((r) => setTimeout(r, 100)),
    ])
    expect(resolved).toBe(false)

    server.close()
  })

  test("waitForCallback resolves when browser hits the path", async () => {
    const server = startCallbackServer("/cb")
    await new Promise((r) => setTimeout(r, 20))

    // Simulate the browser hitting the callback
    setTimeout(() => get(`http://127.0.0.1:${server.port}/cb`), 50)

    await expect(waitForCallback(server, { timeoutMs: 3000 })).resolves.toBeUndefined()
  })

  test("waitForCallback rejects after timeout with no browser hit", async () => {
    const server = startCallbackServer("/cb")
    await new Promise((r) => setTimeout(r, 20))

    await expect(waitForCallback(server, { timeoutMs: 100 })).rejects.toThrow("timed out")
  })

  test("close() rejects the promise and is idempotent", async () => {
    const server = startCallbackServer("/cb")
    await new Promise((r) => setTimeout(r, 20))

    server.close()
    server.close() // second call must not throw

    await expect(server.promise).rejects.toThrow("before callback")
  })
})
