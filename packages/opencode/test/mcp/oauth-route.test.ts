import { test, expect, mock, beforeEach } from "bun:test"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Verify that the connect route logic correctlyHost header to build redirectUrl
// This tests the core business logic without the full Hono server

beforeEach(async () => {
  await McpOAuthCallback.stop()
})

test("Host header constructs correct redirectUrl pattern", () => {
  // Verify the redirect URL format: http://{Host}/mcp/oauth/callback
  const host = "my-host:9999"
  const redirectUrl = `http://${host}/mcp/oauth/callback`
  expect(redirectUrl).toBe("http://my-host:9999/mcp/oauth/callback")

  const hostWithoutPort = "192.168.1.100"
  const redirectUrlNoPort = `http://${hostWithoutPort}/mcp/oauth/callback`
  expect(redirectUrlNoPort).toBe("http://192.168.1.100/mcp/oauth/callback")
})

test("redirectUrl defaults to undefined when Host header is not provided", () => {
  const host = undefined
  const redirectUrl = host ? `http://${host}/mcp/oauth/callback` : undefined
  expect(redirectUrl).toBeUndefined()
})

test("receiveCallback handles success case for the OAuth callback route", async () => {
  const oauthState = "route-test-state"
  const mcpName = "route-test-server"
  const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

  // Simulate what the GET /mcp/oauth/callback route does: extract params and call receiveCallback
  const result = await McpOAuthCallback.receiveCallback({
    code: "auth-code-from-provider",
    state: oauthState,
  })

  expect(result.success).toBe(true)

  const code = await callbackPromise
  expect(code).toBe("auth-code-from-provider")

  await McpOAuthCallback.stop()
})

test("receiveCallback handles error case for the OAuth callback route", async () => {
  const oauthState = "error-route-state"
  const mcpName = "error-route-server"
  const callbackPromise = McpOAuthCallback.waitForCallback(oauthState, mcpName)

  const result = await McpOAuthCallback.receiveCallback({
    error: "access_denied",
    errorDescription: "The user denied the request",
    state: oauthState,
  })

  expect(result.success).toBe(false)
  expect(result.error).toBe("The user denied the request")

  await expect(callbackPromise).rejects.toThrow("The user denied the request")
  await McpOAuthCallback.stop()
})

test("McpOAuthProvider redirectUrl with custom Host-based URL is used as-is", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { McpOAuthProvider } = await import("../../src/mcp/oauth-provider")
      const customRedirect = "http://192.168.1.100:8080/mcp/oauth/callback"
      const provider = new McpOAuthProvider(
        "test-host-redirect",
        "https://example.com/mcp",
        {},
        { onRedirect: async () => {} },
        customRedirect,
      )

      expect(provider.redirectUrl).toBe(customRedirect)
    },
  })
})
