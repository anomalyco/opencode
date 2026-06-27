import { test, expect, describe } from "bun:test"
import { createRequire } from "node:module"

// Other mcp tests `mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", ...)`
// with a stub transport, and bun leaks that mock across files in the suite. We
// need the REAL transport, so import it by resolved absolute path — the mock is
// keyed on the bare specifier and does not intercept an absolute-path import.
const require = createRequire(import.meta.url)
const { StreamableHTTPClientTransport } = await import(
  require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")
)

const MCP_URL = "https://mock.local/mcp"
const TOKEN_URL = "https://mock-as.local/oauth/token"
const AUTHZ_URL = "https://mock-as.local/oauth/authorize"

const jsonResp = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } })

const urlOf = (input: string | URL) => (typeof input === "string" ? input : String(input))

// The SDK sends token requests with a URLSearchParams body, not a string.
const requestBody = (init?: RequestInit) =>
  init?.body instanceof URLSearchParams
    ? init.body
    : new URLSearchParams(typeof init?.body === "string" ? init.body : "")

// Provider backed by a single mutable credential, mirroring opencode's
// disk-backed McpOAuthProvider: tokens() reads it, saveTokens() rotates it,
// invalidateCredentials() wipes it. discoveryState() short-circuits network
// discovery so only the token endpoint is exercised.
function makeProvider() {
  const store: { tokens?: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string } } = {
    tokens: { access_token: "stale", refresh_token: "rt-0", expires_in: 0, scope: "mcp.read" },
  }
  return {
    get redirectUrl() {
      return "http://127.0.0.1:19876/cb"
    },
    get clientMetadata() {
      return {
        redirect_uris: ["http://127.0.0.1:19876/cb"],
        client_name: "Test",
        token_endpoint_auth_method: "none",
        scope: "mcp.read offline_access",
      }
    },
    async clientInformation() {
      return { client_id: "test-client" }
    },
    async tokens() {
      return store.tokens ? { ...store.tokens } : undefined
    },
    async saveTokens(next: NonNullable<typeof store.tokens>) {
      store.tokens = {
        access_token: next.access_token,
        refresh_token: next.refresh_token,
        expires_in: next.expires_in,
        scope: next.scope,
      }
    },
    async invalidateCredentials() {
      store.tokens = undefined
    },
    async discoveryState() {
      return {
        authorizationServerUrl: "https://mock-as.local/",
        resourceMetadata: { resource: "https://mock.local/", scopes_supported: ["mcp.read"] },
        authorizationServerMetadata: {
          issuer: "https://mock-as.local/",
          authorization_endpoint: AUTHZ_URL,
          token_endpoint: TOKEN_URL,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        },
      }
    },
    async validateResourceURL() {
      return undefined
    },
    async state() {
      return "state"
    },
    async saveCodeVerifier() {},
    async saveClientInformation() {},
    async redirectToAuthorization() {},
    async codeVerifier() {
      return "test-verifier"
    },
  }
}

const waitFor = async (cond: () => boolean) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > 3000) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe("StreamableHTTP transport refresh under concurrency", () => {
  test("parallel 401s share a single token refresh (no rotation race)", async () => {
    // The token endpoint rotates: a refresh token is single-use, so reusing the
    // previous one yields invalid_grant. Without single-flight, the 5 parallel
    // 401s each refresh the same stored token and 4 of them lose the rotation
    // race; with it, the token endpoint is hit exactly once.
    const state = { tokenCalls: 0, currentRefresh: "rt-0" }
    const fetchMock = async (input: string | URL, init?: RequestInit) => {
      const url = urlOf(input)
      const method = (init?.method ?? "GET").toUpperCase()
      if (url.startsWith(TOKEN_URL)) {
        state.tokenCalls++
        const rt = requestBody(init).get("refresh_token")
        if (rt && rt === state.currentRefresh) {
          state.currentRefresh = `rt-${state.tokenCalls}`
          return jsonResp(200, {
            access_token: `at-${state.tokenCalls}`,
            token_type: "Bearer",
            refresh_token: state.currentRefresh,
            expires_in: 3600,
          })
        }
        return jsonResp(400, { error: "invalid_grant", error_description: "refresh token already used" })
      }
      if (url.startsWith(MCP_URL)) {
        if (method === "GET") return new Response(null, { status: 405 })
        return new Response("unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": `Bearer error="invalid_token", scope="mcp.read"` },
        })
      }
      return new Response(null, { status: 404 })
    }

    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      authProvider: makeProvider(),
      fetch: fetchMock,
    })
    const sends = Array.from({ length: 5 }, (_, i) =>
      transport.send({ jsonrpc: "2.0", id: i + 1, method: "tools/call", params: { name: "x" } }).catch(() => {}),
    )
    await Promise.allSettled(sends)

    expect(state.tokenCalls).toBe(1)
  })

  test("a staggered 401 after a sibling refresh does not trip the circuit breaker", async () => {
    // Request A refreshes and begins retrying; B's 401 lands in the window where
    // the in-flight refresh promise is already cleared but A's retry has not yet
    // reset the auth-flow flag. An instance-level circuit breaker wrongly throws
    // "Server returned 401 after successful authentication" for B; a per-request
    // breaker must let B refresh + retry instead of dying.
    const gateB = Promise.withResolvers<void>() // holds B's first (stale) 401 response
    const gateARetry = Promise.withResolvers<void>() // holds A's retry (fresh-token) response
    const state = { tokenCalls: 0, staleHits: 0, retryHits: 0 }
    const b = { settled: false, error: "" }

    const fetchMock = async (input: string | URL, init?: RequestInit) => {
      const url = urlOf(input)
      const method = (init?.method ?? "GET").toUpperCase()
      if (url.startsWith(TOKEN_URL)) {
        state.tokenCalls++
        return jsonResp(200, {
          access_token: `at-${state.tokenCalls}`,
          token_type: "Bearer",
          refresh_token: `rt-${state.tokenCalls}`,
          expires_in: 3600,
        })
      }
      if (url.startsWith(MCP_URL)) {
        if (method === "GET") return new Response(null, { status: 405 })
        const bearer = new Headers(init?.headers).get("authorization")
        if (bearer === "Bearer stale") {
          state.staleHits++
          if (state.staleHits === 2) await gateB.promise // park B's first 401 in the bug window
          return new Response("unauth", {
            status: 401,
            headers: { "WWW-Authenticate": `Bearer error="invalid_token", scope="mcp.read"` },
          })
        }
        state.retryHits++
        if (state.retryHits === 1) await gateARetry.promise // hold A's retry so the flag window stays open
        return jsonResp(200, { jsonrpc: "2.0", id: 0, result: {} })
      }
      return new Response(null, { status: 404 })
    }

    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      authProvider: makeProvider(),
      fetch: fetchMock,
    })
    const aDone = transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call" }).then(
      () => {},
      () => {},
    )
    const bDone = transport.send({ jsonrpc: "2.0", id: 2, method: "tools/call" }).then(
      () => {
        b.settled = true
      },
      (e: { message?: string }) => {
        b.settled = true
        b.error = e?.message ?? ""
      },
    )

    // Bug window open: A refreshed, A's retry is held, and B's first 401 is parked.
    await waitFor(() => state.tokenCalls === 1 && state.retryHits === 1 && state.staleHits === 2)
    gateB.resolve() // release B's 401 into the window
    await waitFor(() => b.settled) // B finishes (resolves, or rejects on the old breaker)
    gateARetry.resolve() // let A complete
    await Promise.allSettled([aDone, bDone])

    expect(b.error).not.toContain("Server returned 401 after successful authentication")
  })

  test("finishAuth exchanges the code even while a refresh is in flight", async () => {
    // The single-flight wrapper must NOT swallow the authorization-code exchange.
    // If finishAuth() coalesces into an in-flight refresh, the supplied code is
    // never exchanged (the token endpoint never sees grant_type=authorization_code).
    const gateRefresh = Promise.withResolvers<void>() // holds the in-flight refresh so finishAuth runs concurrently
    const state = { refreshCalls: 0, authCodeGrantSeen: false }

    const fetchMock = async (input: string | URL, init?: RequestInit) => {
      const url = urlOf(input)
      const method = (init?.method ?? "GET").toUpperCase()
      if (url.startsWith(TOKEN_URL)) {
        if (requestBody(init).get("grant_type") === "authorization_code") {
          state.authCodeGrantSeen = true
          return jsonResp(200, {
            access_token: "at-code",
            token_type: "Bearer",
            refresh_token: "rt-code",
            expires_in: 3600,
          })
        }
        state.refreshCalls++
        await gateRefresh.promise // hold the refresh so it stays in-flight
        return jsonResp(200, { access_token: "at-r", token_type: "Bearer", refresh_token: "rt-r", expires_in: 3600 })
      }
      if (url.startsWith(MCP_URL)) {
        if (method === "GET") return new Response(null, { status: 405 })
        return new Response("unauth", {
          status: 401,
          headers: { "WWW-Authenticate": `Bearer error="invalid_token", scope="mcp.read"` },
        })
      }
      return new Response(null, { status: 404 })
    }

    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      authProvider: makeProvider(),
      fetch: fetchMock,
    })
    const send = transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call" }).then(
      () => {},
      () => {},
    )
    await waitFor(() => state.refreshCalls === 1) // a refresh is in-flight and held
    const fin = transport.finishAuth("auth-code-xyz").then(
      () => {},
      () => {},
    )
    await new Promise((r) => setTimeout(r, 50)) // give finishAuth time to exchange (fix) or coalesce (bug)
    gateRefresh.resolve()
    await Promise.allSettled([send, fin])

    expect(state.authCodeGrantSeen).toBe(true)
  })
})
