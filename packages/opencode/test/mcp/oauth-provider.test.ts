import { test, expect, describe } from "bun:test"
import { McpOAuthProvider, OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH, resolveCallback } from "../../src/mcp/oauth-provider"
import type { McpAuth } from "../../src/mcp/auth"

// Stub auth — only synchronous getters are exercised in these tests
const stubAuth = {} as McpAuth.Interface

const makeProvider = (config: ConstructorParameters<typeof McpOAuthProvider>[2]) =>
  new McpOAuthProvider("test-server", "https://mcp.example.com/mcp", config, { onRedirect: async () => {} }, stubAuth)

describe("McpOAuthProvider.redirectUrl", () => {
  test("defaults to 127.0.0.1:19876/mcp/oauth/callback", () => {
    const provider = makeProvider({})
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`)
  })

  test("uses callbackPort when set", () => {
    const provider = makeProvider({ callbackPort: 6620 })
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:6620${OAUTH_CALLBACK_PATH}`)
  })

  test("uses callbackPath when set without redirectUri", () => {
    const provider = makeProvider({ callbackPath: "/custom/callback" })
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}/custom/callback`)
  })

  test("normalizes callbackPath when set without redirectUri", () => {
    const provider = makeProvider({ callbackPath: "custom/callback" })
    expect(provider.redirectUrl).toBe(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}/custom/callback`)
  })

  test("redirectUri takes precedence over callbackPort", () => {
    const provider = makeProvider({
      callbackPort: 6620,
      callbackPath: "/local/callback",
      redirectUri: "http://127.0.0.1:9999/custom/callback",
    })
    expect(provider.redirectUrl).toBe("http://127.0.0.1:9999/custom/callback")
  })

  test("uses explicit redirectUri when set without callbackPort", () => {
    const provider = makeProvider({ redirectUri: "http://127.0.0.1:8080/oauth/callback" })
    expect(provider.redirectUrl).toBe("http://127.0.0.1:8080/oauth/callback")
  })
})

describe("McpOAuthProvider.clientMetadata", () => {
  test("includes redirect_uris from redirectUrl", () => {
    const provider = makeProvider({ callbackPort: 6620 })
    expect(provider.clientMetadata.redirect_uris).toEqual([`http://127.0.0.1:6620${OAUTH_CALLBACK_PATH}`])
  })

  test("keeps public redirectUri in provider metadata", () => {
    const provider = makeProvider({
      callbackPort: 19876,
      callbackPath: "/mcp/oauth/callback",
      redirectUri: "https://jove.example.com/hub/user-redirect/proxy/19876/mcp/oauth/callback",
    })
    expect(provider.clientMetadata.redirect_uris).toEqual([
      "https://jove.example.com/hub/user-redirect/proxy/19876/mcp/oauth/callback",
    ])
  })

  test("includes scope when set in config", () => {
    const provider = makeProvider({ scope: "openid offline_access" })
    expect(provider.clientMetadata.scope).toBe("openid offline_access")
  })

  test("omits scope when not set in config", () => {
    const provider = makeProvider({})
    expect(provider.clientMetadata.scope).toBeUndefined()
  })

  test("sets token_endpoint_auth_method to client_secret_post when clientSecret provided", () => {
    const provider = makeProvider({ clientSecret: "secret" })
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("client_secret_post")
  })

  test("sets token_endpoint_auth_method to none when no clientSecret", () => {
    const provider = makeProvider({})
    expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none")
  })
})

describe("resolveCallback", () => {
  test("uses explicit callbackPort and callbackPath independently of public redirectUri", () => {
    const result = resolveCallback(
      "https://jove.example.com/hub/user-redirect/proxy/19876/mcp/oauth/callback",
      19876,
      "/mcp/oauth/callback",
    )
    expect(result).toEqual({ port: 19876, path: "/mcp/oauth/callback" })
  })

  test("preserves non-local redirectUri compatibility without callback override", () => {
    const result = resolveCallback("https://oauth.example.com:8443/custom/callback")
    expect(result).toEqual({ port: 8443, path: "/custom/callback" })
  })

  test("preserves non-local redirectUri when only callbackPort is also set", () => {
    const result = resolveCallback("https://oauth.example.com:8443/custom/callback", 6620)
    expect(result).toEqual({ port: 8443, path: "/custom/callback" })
  })

  test("uses callback override for public HTTPS redirectUri", () => {
    const result = resolveCallback(
      "https://jove.example.com/hub/user-redirect/proxy/19876/mcp/oauth/callback",
      19876,
      "mcp/oauth/callback",
    )
    expect(result).toEqual({ port: 19876, path: "/mcp/oauth/callback" })
  })

  test("preserves localhost redirectUri compatibility", () => {
    const result = resolveCallback("http://127.0.0.1:8080/oauth/callback")
    expect(result).toEqual({ port: 8080, path: "/oauth/callback" })
  })

  test("preserves localhost redirectUri when callback shorthand is also set", () => {
    const result = resolveCallback("http://127.0.0.1:8080/oauth/callback", 6620, "/other/callback")
    expect(result).toEqual({ port: 8080, path: "/oauth/callback" })
  })

  test("keeps callbackPort-only behavior", () => {
    const result = resolveCallback(undefined, 6620)
    expect(result).toEqual({ port: 6620, path: OAUTH_CALLBACK_PATH })
  })
})
