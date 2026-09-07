import { afterAll, describe, expect, test } from "bun:test"
import { auth, refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
import { Credential } from "@opencode-ai/schema/credential"
import { Integration } from "@opencode-ai/core/integration"
import { McpOAuth } from "@opencode-ai/core/mcp/oauth"
import { Effect } from "effect"

const authServer = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
afterAll(() => authServer.stop(true))

const authorize = (redirect_uri?: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const authorization = yield* McpOAuth.authorize({
          name: "test",
          config: new ConfigMCP.Remote({
            type: "remote",
            url: authServer.url.href,
            oauth: { client_id: "client", ...(redirect_uri ? { redirect_uri } : {}) },
          }),
          methodID: Integration.MethodID.make("oauth"),
        })
        return new URL(authorization.url).searchParams.get("redirect_uri")
      }),
    ),
  )

describe("MCP OAuth", () => {
  test("completes interactive authorization through the loopback callback", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({
          access_token: "access",
          token_type: "Bearer",
          refresh_token: "refresh",
          expires_in: 3600,
        })
      },
    })

    const credential = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const authorization = yield* McpOAuth.authorize({
            name: "test",
            config: new ConfigMCP.Remote({
              type: "remote",
              url: server.url.href,
              oauth: { client_id: "client" },
            }),
            methodID: Integration.MethodID.make("oauth"),
          })
          const authorizationUrl = new URL(authorization.url)
          const redirectValue = authorizationUrl.searchParams.get("redirect_uri")
          const state = authorizationUrl.searchParams.get("state")
          if (!redirectValue || !state) throw new Error("Missing OAuth redirect parameters")
          const redirect = new URL(redirectValue)
          redirect.searchParams.set("code", "accepted")
          redirect.searchParams.set("state", state)
          expect((yield* Effect.promise(() => fetch(redirect))).status).toBe(200)
          return yield* authorization.callback
        }),
      ),
    ).finally(() => server.stop(true))

    expect(credential.access).toBe("access")
    expect(credential.refresh).toBe("refresh")
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]?.get("grant_type")).toBe("authorization_code")
    expect(tokenRequests[0]?.get("code")).toBe("accepted")
    expect(tokenRequests[0]?.get("code_verifier")).not.toBeNull()
  })

  test("refreshes tokens loaded from a persisted credential", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({ access_token: "next", token_type: "Bearer" })
      },
    })
    const store = McpOAuth.memoryStore()
    await store.saveTokens(
      McpOAuth.toTokens(
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("oauth"),
          access: "expired",
          refresh: "refresh",
          expires: Date.now() - 1000,
          metadata: { serverUrl: server.url.href, tokenType: "Bearer" },
        }),
      ),
    )
    const oauthProvider = McpOAuth.provider({
      redirectUrl: "http://127.0.0.1/callback",
      client: { id: "client" },
      onRedirect: () => undefined,
      store,
    })

    const result = await auth(oauthProvider, { serverUrl: server.url.href }).finally(() => server.stop(true))

    expect(result).toBe("AUTHORIZED")
    expect(await store.tokens()).toEqual({ access_token: "next", token_type: "Bearer", refresh_token: "refresh" })
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
    expect(tokenRequests[0]?.get("refresh_token")).toBe("refresh")
  })

  test("shares concurrent refreshes for the same token", async () => {
    let requests = 0
    const pending = Promise.withResolvers<void>()
    const options = {
      metadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        response_types_supported: ["code"],
      },
      clientInformation: { client_id: "client" },
      refreshToken: "refresh",
      fetchFn: async () => {
        requests++
        await pending.promise
        return Response.json({ access_token: "access", token_type: "Bearer", refresh_token: "next" })
      },
    }

    const first = refreshAuthorization(new URL("https://auth.example.com"), options)
    const second = refreshAuthorization(new URL("https://auth.example.com"), options)
    await Promise.resolve()

    expect(requests).toBe(1)
    pending.resolve()
    expect(await Promise.all([first, second])).toEqual([
      { access_token: "access", token_type: "Bearer", refresh_token: "next" },
      { access_token: "access", token_type: "Bearer", refresh_token: "next" },
    ])
  })

  test("follows the resource_metadata URL from the WWW-Authenticate challenge", async () => {
    const issuer = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname !== "/.well-known/oauth-authorization-server") return new Response(null, { status: 404 })
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        })
      },
    })
    const metadataRequests: string[] = []
    // Bedrock AgentCore shape: metadata lives under the resource path with a query string, the domain
    // root well-known 404s, and the authorization server is a different host.
    const resource = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        const metadata = `${url.origin}/runtimes/example/invocations/.well-known/oauth-protected-resource?qualifier=dev`
        if (request.method === "POST" && url.pathname === "/runtimes/example/invocations")
          return new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": `Bearer resource_metadata="${metadata}", scope="mcp:read"` },
          })
        if (url.href === metadata) {
          metadataRequests.push(url.href)
          return Response.json({
            resource: `${url.origin}/runtimes/example/invocations`,
            authorization_servers: [issuer.url.origin],
          })
        }
        return new Response(null, { status: 404 })
      },
    })

    try {
      const authorization = await Effect.runPromise(
        Effect.scoped(
          McpOAuth.authorize({
            name: "agentcore",
            config: new ConfigMCP.Remote({
              type: "remote",
              url: `${resource.url.origin}/runtimes/example/invocations?qualifier=dev`,
              oauth: { client_id: "client" },
            }),
            methodID: Integration.MethodID.make("oauth"),
          }),
        ),
      )
      const url = new URL(authorization.url)
      expect(url.origin).toBe(issuer.url.origin)
      expect(url.pathname).toBe("/authorize")
      expect(url.searchParams.get("scope")).toBe("mcp:read")
      expect(metadataRequests).toEqual([
        `${resource.url.origin}/runtimes/example/invocations/.well-known/oauth-protected-resource?qualifier=dev`,
      ])
    } finally {
      resource.stop(true)
      issuer.stop(true)
    }
  })

  test("generates a loopback redirect URL when none is configured", async () => {
    expect(await authorize()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  })

  test("preserves a configured redirect URL and fixed port", async () => {
    const reservation = Bun.serve({ port: 0, fetch: () => new Response() })
    const redirect = `http://127.0.0.1:${reservation.port}/fixed-callback`
    reservation.stop(true)

    expect(await authorize(redirect)).toBe(redirect)
  })

  test("rejects an invalid redirect URL", async () => {
    await expect(authorize("not a URL")).rejects.toThrow(TypeError)
  })
})
