import { test, expect, describe, afterEach } from "bun:test"
import { createConnection, createServer as createNetServer } from "net"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { parseRedirectUri } from "../../src/mcp/oauth-provider"

async function getFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      probe.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port)
          return
        }
        reject(new Error("Could not allocate a loopback port"))
      })
    })
  })
}

async function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const done = (ok: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }

    socket.setTimeout(500)
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
    socket.once("timeout", () => done(false))
  })
}

describe("parseRedirectUri", () => {
  test("returns defaults when no URI provided", () => {
    const result = parseRedirectUri()
    expect(result.port).toBe(19876)
    expect(result.path).toBe("/mcp/oauth/callback")
  })

  test("parses port and path from URI", () => {
    const result = parseRedirectUri("http://127.0.0.1:8080/oauth/callback")
    expect(result.port).toBe(8080)
    expect(result.path).toBe("/oauth/callback")
  })

  test("returns defaults for invalid URI", () => {
    const result = parseRedirectUri("not-a-valid-url")
    expect(result.port).toBe(19876)
    expect(result.path).toBe("/mcp/oauth/callback")
  })
})

describe("McpOAuthCallback.ensureRunning", () => {
  afterEach(async () => {
    await McpOAuthCallback.stop()
  })

  test("starts server with custom redirectUri port and path", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18000/custom/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("stops after the callback completes", async () => {
    const redirectUri = "http://127.0.0.1:18003/custom/callback"
    await McpOAuthCallback.ensureRunning(redirectUri)
    const callback = McpOAuthCallback.waitForCallback("success")

    const response = await fetch(`${redirectUri}?code=code&state=success`)

    expect(response.status).toBe(200)
    expect(await callback).toBe("code")
    expect(McpOAuthCallback.isRunning()).toBe(false)
  })

  test("escapes provider error markup in callback HTML", async () => {
    const redirectUri = "http://127.0.0.1:18001/custom/callback"
    await McpOAuthCallback.ensureRunning(redirectUri)

    const error = `<script>alert("xss" & 'more')</script>`
    const response = await fetch(
      `${redirectUri}?state=test&error=access_denied&error_description=${encodeURIComponent(error)}`,
    )
    const body = await response.text()

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(body).toContain("&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;more&#39;)&lt;/script&gt;")
    expect(body).not.toContain(error)
  })

  test("keeps normal provider errors readable", async () => {
    const redirectUri = "http://127.0.0.1:18002/custom/callback"
    await McpOAuthCallback.ensureRunning(redirectUri)

    const response = await fetch(
      `${redirectUri}?state=test&error=access_denied&error_description=${encodeURIComponent("The user denied access")}`,
    )

    expect(await response.text()).toContain('<div class="error">The user denied access</div>')
  })

  test("binds the callback server to IPv4 loopback", async () => {
    const port = await getFreeLoopbackPort()
    await McpOAuthCallback.ensureRunning(`http://127.0.0.1:${port}/custom/callback`)

    expect(await canConnect("127.0.0.1", port)).toBe(true)
    expect(await canConnect("::1", port)).toBe(false)
  })
})
