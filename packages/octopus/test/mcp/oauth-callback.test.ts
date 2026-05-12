import { test, expect, describe, afterEach } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { parseRedirectUri } from "../../src/mcp/oauth-provider"
import { createServer } from "net"

/** Find a dynamically-allocated available port to avoid port conflicts. */
async function getAvailablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = createServer()
    s.listen(0, () => {
      const { port } = s.address() as import("net").AddressInfo
      s.close(() => resolve(port))
    })
    s.on("error", reject)
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
    const port = await getAvailablePort()
    await McpOAuthCallback.ensureRunning(`http://127.0.0.1:${port}/custom/callback`)
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })
})
