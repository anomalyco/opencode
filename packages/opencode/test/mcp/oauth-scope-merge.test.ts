import { test, expect, describe } from "bun:test"
import { createRequire } from "node:module"

// Other mcp tests `mock.module("@modelcontextprotocol/sdk/client/auth.js", ...)`
// (those mocks only export UnauthorizedError) and bun leaks that across files in
// the suite. Import the REAL module by resolved absolute path — the mock is keyed
// on the bare specifier and does not intercept an absolute-path import.
const require = createRequire(import.meta.url)
const { auth } = await import(require.resolve("@modelcontextprotocol/sdk/client/auth.js"))

// These tests pin the patched SDK scope-selection behavior (see
// patches/@modelcontextprotocol%2Fsdk@1.29.0.patch): the config `scope` from
// clientMetadata must be MERGED on top of the server-advertised resource
// scopes, not used only as a last-resort fallback. This is what lets
// `offline_access` (a client<->AS scope a resource server never advertises) be
// requested so the AS issues a refresh token. See opencode issue #34034.

const SERVER_URL = "https://mcp.example.com/mcp"
const AS_URL = "https://as.example.com/"
const AUTHORIZE = "https://as.example.com/authorize"

// Drive the real SDK auth() flow with no network: returning discoveryState()
// makes authInternal skip RFC 9728 discovery, and returning clientInformation()
// skips dynamic client registration. The flow reaches startAuthorization() and
// hands the final authorization URL to redirectToAuthorization(), which we
// capture to inspect the requested `scope`.
async function capturedAuthorizationScope(opts: {
  advertisedScopes?: string[]
  configScope?: string
}): Promise<string | null> {
  const captured: { url?: URL } = {}

  const provider = {
    get redirectUrl() {
      return "http://127.0.0.1:19876/mcp/oauth/callback"
    },
    get clientMetadata() {
      return {
        redirect_uris: ["http://127.0.0.1:19876/mcp/oauth/callback"],
        client_name: "OpenCode",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(opts.configScope ? { scope: opts.configScope } : {}),
      }
    },
    async clientInformation() {
      return { client_id: "test-client" }
    },
    async tokens() {
      return undefined
    },
    async state() {
      return "state-123"
    },
    async discoveryState() {
      return {
        authorizationServerUrl: AS_URL,
        resourceMetadata: {
          resource: "https://mcp.example.com/",
          ...(opts.advertisedScopes ? { scopes_supported: opts.advertisedScopes } : {}),
        },
        authorizationServerMetadata: {
          issuer: AS_URL,
          authorization_endpoint: AUTHORIZE,
          token_endpoint: "https://as.example.com/token",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
      }
    },
    // Skip the `resource` param + RFC 8707 compatibility check for the test.
    async validateResourceURL() {
      return undefined
    },
    async saveCodeVerifier() {},
    async saveClientInformation() {},
    async saveTokens() {},
    async redirectToAuthorization(url: URL) {
      captured.url = url
    },
  }

  const result = await auth(provider, { serverUrl: SERVER_URL })
  expect(result).toBe("REDIRECT")
  return captured.url?.searchParams.get("scope") ?? null
}

const asSet = (scope: string | null) => new Set((scope ?? "").split(/\s+/).filter(Boolean))

describe("MCP SDK scope selection (patched)", () => {
  test("merges config scope on top of advertised resource scopes", async () => {
    const scope = await capturedAuthorizationScope({
      advertisedScopes: ["mcp:read", "mcp:write"],
      configScope: "openid offline_access mcp:read mcp:write",
    })

    expect(asSet(scope)).toEqual(new Set(["mcp:read", "mcp:write", "openid", "offline_access"]))
  })

  test("adds offline_access when config lists only the extra scope", async () => {
    const scope = await capturedAuthorizationScope({
      advertisedScopes: ["mcp:read"],
      configScope: "offline_access",
    })

    expect(asSet(scope)).toEqual(new Set(["mcp:read", "offline_access"]))
  })

  test("leaves advertised scopes untouched when no config scope is set", async () => {
    const scope = await capturedAuthorizationScope({
      advertisedScopes: ["mcp:read", "mcp:write"],
    })

    expect(asSet(scope)).toEqual(new Set(["mcp:read", "mcp:write"]))
  })

  test("falls back to config scope when server advertises none (#28810)", async () => {
    const scope = await capturedAuthorizationScope({
      configScope: "openid offline_access",
    })

    expect(asSet(scope)).toEqual(new Set(["openid", "offline_access"]))
  })
})
