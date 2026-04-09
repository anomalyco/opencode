import { test, expect, describe, afterEach } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { McpOAuthProvider, parseRedirectUri } from "../../src/mcp/oauth-provider"

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
    await McpOAuthCallback.ensureRunning({ redirectUri: "http://127.0.0.1:18000/custom/callback" })
    expect(McpOAuthCallback.isRunning()).toBe(true)
    expect(await McpOAuthCallback.isPortInUse(18000)).toBe(true)
  })

  test("allows wildcard callbackHost with explicit redirectUri", async () => {
    await McpOAuthCallback.ensureRunning({
      redirectUri: "http://127.0.0.1:18002/custom/callback",
      callbackHost: "0.0.0.0",
    })

    expect(McpOAuthCallback.isRunning()).toBe(true)
    expect(await McpOAuthCallback.isPortInUse(18002, "127.0.0.1")).toBe(true)
  })

  test("binds to redirectUri host by default", async () => {
    await McpOAuthCallback.ensureRunning({ redirectUri: "http://127.0.0.1:18003/custom/callback" })
    expect(await McpOAuthCallback.isPortInUse(18003, "127.0.0.1")).toBe(true)
  })
})
