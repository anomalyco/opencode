import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { parseRedirectUri } from "../../src/mcp/oauth-provider"

beforeEach(async () => {
  await McpOAuthCallback.stop()
})

afterEach(async () => {
  await McpOAuthCallback.stop()
})

describe("McpOAuthCallback", () => {
  test("receiveCallback resolves pending auth with the authorization code", async () => {
    const oauthState = "test-state-123"
    const mcpName = "test-server"
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

    const result = await McpOAuthCallback.receiveCallback({
      code: "auth-code-abc",
      state: oauthState,
    })

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    const code = await callbackPromise
    expect(code).toBe("auth-code-abc")
  })

  test("receiveCallback rejects pending auth on OAuth error", async () => {
    const oauthState = "error-state-456"
    const mcpName = "error-server"
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

    const result = await McpOAuthCallback.receiveCallback({
      error: "access_denied",
      errorDescription: "User denied access",
      state: oauthState,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("User denied access")

    await expect(callbackPromise).rejects.toThrow("User denied access")
  })

  test("receiveCallback returns error when state is missing", async () => {
    const result = await McpOAuthCallback.receiveCallback({
      code: "some-code",
      state: null,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required state parameter")
  })

  test("receiveCallback returns error when code is missing", async () => {
    const oauthState = "no-code-state"
    const mcpName = "no-code-server"
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

    const result = await McpOAuthCallback.receiveCallback({
      code: null,
      state: oauthState,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("No authorization code provided")

    McpOAuthCallback.cancelPending(mcpName)
    await expect(callbackPromise).rejects.toThrow()
  })

  test("receiveCallback returns error for invalid/expired state", async () => {
    const result = await McpOAuthCallback.receiveCallback({
      code: "auth-code",
      state: "unknown-state-that-was-never-registered",
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("Invalid or expired state parameter")
  })

  test("cancelPending rejects the callback promise for the given mcpName", async () => {
    const oauthState = "cancel-state"
    const mcpName = "cancel-server"
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

    McpOAuthCallback.cancelPending(mcpName)

    await expect(callbackPromise).rejects.toThrow("Authorization cancelled")
  })

  test("receiveCallback uses error over errorDescription when errorDescription is absent", async () => {
    const oauthState = "error-no-desc"
    const mcpName = "error-no-desc-server"
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

    const result = await McpOAuthCallback.receiveCallback({
      error: "server_error",
      errorDescription: null,
      state: oauthState,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("server_error")

    await expect(callbackPromise).rejects.toThrow("server_error")
  })

  test("waitForCallback registers mcpName-to-state reverse mapping", async () => {
    const oauthState = "reverse-mapping-state"
    const mcpName = "reverse-mapping-server"
    const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

    McpOAuthCallback.cancelPending(mcpName)

    await expect(callbackPromise).rejects.toThrow("Authorization cancelled")
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

  test("returns defaults for invalid URI", () => {
    const result = parseRedirectUri("not-a-valid-url")
    expect(result.port).toBe(19876)
    expect(result.path).toBe("/mcp/oauth/callback")
  })
})

describe("McpOAuthCallback.ensureRunning", () => {
  test("starts server with custom redirectUri port and path", async () => {
    await McpOAuthCallback.ensureRunning("http://127.0.0.1:18000/custom/callback")
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })
})
