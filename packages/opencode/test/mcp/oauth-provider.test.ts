import { test, expect, describe } from "bun:test"
import { McpOAuthProvider, OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH } from "../../src/mcp/oauth-provider"
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

  test("redirectUri takes precedence over callbackPort", () => {
    const provider = makeProvider({
      callbackPort: 6620,
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

describe("McpOAuthProvider.redirectToAuthorization", () => {
  test("appends scope from config when URL lacks it", async () => {
    let captured: URL | undefined
    const provider = new McpOAuthProvider(
      "test-scope",
      "https://mcp.example.com/mcp",
      { clientId: "pre-registered-id", scope: "openid offline_access" },
      { onRedirect: async (url) => { captured = url } },
      stubAuth,
    )

    const urlWithoutScope = new URL(
      "https://auth.example.com/authorize?client_id=test&state=abc&code_challenge=xyz&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A19876%2Fmcp%2Foauth%2Fcallback",
    )
    await provider.redirectToAuthorization(urlWithoutScope)

    expect(captured?.searchParams.get("scope")).toBe("openid offline_access")
  })

  test("does NOT append scope when URL already has it (SDK upgraded)", async () => {
    let captured: URL | undefined
    const provider = new McpOAuthProvider(
      "test-scope-dup",
      "https://mcp.example.com/mcp",
      { clientId: "pre-registered-id", scope: "openid profile" },
      { onRedirect: async (url) => { captured = url } },
      stubAuth,
    )

    const urlWithScope = new URL("https://auth.example.com/authorize?client_id=test&scope=openid%20email&state=abc")
    await provider.redirectToAuthorization(urlWithScope)

    // URL should keep the SDK's scope, not overwrite with config scope
    expect(captured?.searchParams.get("scope")).toBe("openid email")
  })

  test("does NOT append scope when config has none", async () => {
    let captured: URL | undefined
    const provider = new McpOAuthProvider(
      "test-no-scope",
      "https://mcp.example.com/mcp",
      { clientId: "pre-registered-id" },
      { onRedirect: async (url) => { captured = url } },
      stubAuth,
    )

    const url = new URL("https://auth.example.com/authorize?client_id=test&state=abc")
    await provider.redirectToAuthorization(url)

    expect(captured?.searchParams.has("scope")).toBe(false)
  })

  test("does NOT append scope when scope config is empty string", async () => {
    let captured: URL | undefined
    const provider = new McpOAuthProvider(
      "test-empty-scope",
      "https://mcp.example.com/mcp",
      { clientId: "pre-registered-id", scope: "" },
      { onRedirect: async (url) => { captured = url } },
      stubAuth,
    )

    const url = new URL("https://auth.example.com/authorize?client_id=test&state=abc")
    await provider.redirectToAuthorization(url)

    expect(captured?.searchParams.has("scope")).toBe(false)
  })

  test("URL-encodes multi-space scope correctly", async () => {
    let captured: URL | undefined
    const provider = new McpOAuthProvider(
      "test-multi-scope",
      "https://mcp.example.com/mcp",
      { clientId: "pre-registered-id", scope: "openid email profile offline_access" },
      { onRedirect: async (url) => { captured = url } },
      stubAuth,
    )

    const url = new URL("https://auth.example.com/authorize?client_id=test&state=abc")
    await provider.redirectToAuthorization(url)

    expect(captured?.searchParams.get("scope")).toBe("openid email profile offline_access")
  })

  test("appends scope to URL that has no query params", async () => {
    let captured: URL | undefined
    const provider = new McpOAuthProvider(
      "test-no-params",
      "https://mcp.example.com/mcp",
      { scope: "openid" },
      { onRedirect: async (url) => { captured = url } },
      stubAuth,
    )

    const url = new URL("https://auth.example.com/authorize")
    await provider.redirectToAuthorization(url)

    expect(captured?.searchParams.get("scope")).toBe("openid")
  })

  test("preserves all existing params when appending scope", async () => {
    let captured: URL | undefined
    const provider = new McpOAuthProvider(
      "test-preserve",
      "https://mcp.example.com/mcp",
      { scope: "openid" },
      { onRedirect: async (url) => { captured = url } },
      stubAuth,
    )

    const url = new URL(
      "https://auth.example.com/authorize?response_type=code&client_id=myclient&state=xyz&code_challenge=abc123&code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A19876%2Fcallback",
    )
    await provider.redirectToAuthorization(url)

    expect(captured?.searchParams.get("response_type")).toBe("code")
    expect(captured?.searchParams.get("client_id")).toBe("myclient")
    expect(captured?.searchParams.get("state")).toBe("xyz")
    expect(captured?.searchParams.get("code_challenge")).toBe("abc123")
    expect(captured?.searchParams.get("code_challenge_method")).toBe("S256")
    expect(captured?.searchParams.get("scope")).toBe("openid")
  })
})
