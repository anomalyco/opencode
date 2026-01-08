import { test, expect, describe, afterEach } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { parseRedirectUri } from "../../src/mcp/oauth-provider"

describe("McpOAuthCallback.ensureRunning", () => {
  afterEach(async () => {
    await McpOAuthCallback.stop()
  })

  test("starts server with default config when no redirectUri provided", async () => {
    await McpOAuthCallback.ensureRunning()
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("starts server with custom redirectUri", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18000/custom/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("is idempotent when called with same redirectUri", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18001/callback")
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18001/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("restarts server when redirectUri changes", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18002/path1")
    expect(McpOAuthCallback.isRunning()).toBe(true)

    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18003/path2")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("isRunning returns false when not started", async () => {
    expect(McpOAuthCallback.isRunning()).toBe(false)
  })

  test("isRunning returns false after stop", async () => {
    await McpOAuthCallback.ensureRunning()
    await McpOAuthCallback.stop()
    expect(McpOAuthCallback.isRunning()).toBe(false)
  })
})

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

  test("defaults to port 80 for http without explicit port", () => {
    const result = parseRedirectUri("http://127.0.0.1/callback")
    expect(result.port).toBe(80)
    expect(result.path).toBe("/callback")
  })

  test("defaults to port 443 for https without explicit port", () => {
    const result = parseRedirectUri("https://127.0.0.1/callback")
    expect(result.port).toBe(443)
    expect(result.path).toBe("/callback")
  })

  test("returns defaults for invalid URI", () => {
    const result = parseRedirectUri("not-a-valid-url")
    expect(result.port).toBe(19876)
    expect(result.path).toBe("/mcp/oauth/callback")
  })
})
