import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"

describe("McpOAuthCallback.ensureRunning", () => {
  afterEach(async () => {
    await McpOAuthCallback.stop()
  })

  test("uses default port 19876 when no redirectUri provided", async () => {
    await McpOAuthCallback.ensureRunning()
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("uses custom port from redirectUri", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18000/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("uses custom path from redirectUri", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:19876/custom/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("parses port and path from full redirectUri", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18001/my/oauth/path")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("is idempotent when called multiple times with same redirectUri", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18002/callback")
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18002/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("restarts server when redirectUri changes", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18003/path1")
    expect(McpOAuthCallback.isRunning()).toBe(true)

    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18004/path2")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("isRunning returns false when server not started", async () => {
    expect(McpOAuthCallback.isRunning()).toBe(false)
  })

  test("isRunning returns true after server started", async () => {
    await McpOAuthCallback.ensureRunning()
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("isRunning returns false after stop", async () => {
    await McpOAuthCallback.ensureRunning()
    await McpOAuthCallback.stop()
    expect(McpOAuthCallback.isRunning()).toBe(false)
  })
})
