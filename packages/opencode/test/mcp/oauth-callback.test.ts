import { test, expect, beforeEach } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"

beforeEach(async () => {
  await McpOAuthCallback.stop()
})

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

  await McpOAuthCallback.stop()
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

  await McpOAuthCallback.stop()
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
  // We don't await this promise, just register it so receiveCallback can check state
  const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

  const result = await McpOAuthCallback.receiveCallback({
    code: null,
    state: oauthState,
  })

  expect(result.success).toBe(false)
  expect(result.error).toContain("No authorization code provided")

  // Clean up: cancel the pending promise
  McpOAuthCallback.cancelPending(mcpName)
  await expect(callbackPromise).rejects.toThrow()
  await McpOAuthCallback.stop()
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

  await McpOAuthCallback.stop()
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
  await McpOAuthCallback.stop()
})

test("waitForCallback registers mcpName-to-state reverse mapping", async () => {
  const oauthState = "reverse-mapping-state"
  const mcpName = "reverse-mapping-server"
  const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

  // cancelPending should find the entry by mcpName
  McpOAuthCallback.cancelPending(mcpName)

  await expect(callbackPromise).rejects.toThrow("Authorization cancelled")
  await McpOAuthCallback.stop()
})
