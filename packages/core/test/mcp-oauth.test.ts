import { afterAll, describe, expect, test } from "bun:test"
import { auth, IssuerMismatchError, refreshAuthorization } from "@modelcontextprotocol/client"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
import { Credential } from "@opencode-ai/schema/credential"
import { Integration } from "@opencode-ai/core/integration"
import { McpOAuth } from "@opencode-ai/core/mcp/oauth"
import { Effect, Logger } from "effect"
import { it } from "./lib/effect"

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
  it.live("logs OAuth rejection codes without consuming the response or logging credentials", () =>
    Effect.gen(function* () {
      const body = { error: "invalid_grant", error_description: "rejected private-refresh-token" }
      const server = yield* Effect.acquireRelease(
        Effect.sync(() => Bun.serve({ port: 0, fetch: () => Response.json(body, { status: 400 }) })),
        (server) => Effect.promise(() => server.stop(true)),
      )
      const logged: unknown[] = []
      const response = yield* Effect.gen(function* () {
        const request = yield* McpOAuth.loggedFetch({ server: "test" })
        return yield* Effect.promise(() =>
          request(server.url, {
            method: "POST",
            body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "private-refresh-token" }),
          }),
        )
      }).pipe(
        Effect.provideService(Logger.CurrentLoggers, new Set([Logger.make((entry) => logged.push(entry.message))])),
      )
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => response.json())).toEqual(body)
      expect(JSON.stringify(logged)).toContain("invalid_grant")
      expect(JSON.stringify(logged)).not.toContain("private-refresh-token")
    }),
  )

  test("retains issuer stamps for configured clients without overriding changed configuration", async () => {
    const store = McpOAuth.memoryStore()
    const provider = McpOAuth.provider({
      redirectUrl: "http://127.0.0.1/callback",
      client: { id: "client", secret: "secret" },
      onRedirect: () => {},
      store,
    })
    const client = { client_id: "client", client_secret: "secret", issuer: "https://auth.example.com" }
    await store.saveClientInformation(client)
    expect(await provider.clientInformation()).toEqual(client)
    await store.saveClientInformation({ ...client, client_secret: "old-secret" })
    expect(await provider.clientInformation()).toEqual({ client_id: "client", client_secret: "secret" })
  })

  test("round-trips issuer stamps on tokens and registered clients", () => {
    const tokens = {
      access_token: "access",
      refresh_token: "refresh",
      token_type: "Bearer",
      scope: "read",
      issuer: "https://auth.example.com",
    }
    const client = { client_id: "client", issuer: tokens.issuer }
    const credential = McpOAuth.toCredential({
      methodID: Integration.MethodID.make("oauth"),
      serverUrl: "https://mcp.example.com",
      tokens,
      client,
    })

    expect(McpOAuth.toTokens(credential)).toEqual(tokens)
    expect(McpOAuth.clientFromCredential(credential)).toEqual(client)
  })

  test("does not invent an issuer for legacy credentials", () => {
    const tokens = { access_token: "access", token_type: "Bearer" }
    const credential = McpOAuth.toCredential({
      methodID: Integration.MethodID.make("oauth"),
      serverUrl: "https://mcp.example.com",
      tokens,
      client: undefined,
    })

    expect(McpOAuth.toTokens(credential)).toEqual(tokens)
    expect(credential.metadata).not.toHaveProperty("issuer")
  })

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
    expect(await store.tokens()).toEqual({
      access_token: "next",
      token_type: "Bearer",
      refresh_token: "refresh",
      issuer: server.url.href,
    })
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
  ;[
    { name: "accepts a matching issuer", iss: "matching", supported: true, state: true },
    { name: "accepts an omitted issuer when not required", iss: "missing", supported: false, state: true },
    { name: "rejects a mismatched issuer even when optional", iss: "mismatch", supported: false, state: true },
    { name: "rejects an omitted required issuer", iss: "missing", supported: true, state: true },
    { name: "rejects a mismatched state", iss: "matching", supported: true, state: false },
  ].forEach((input) => {
    it.live(
      input.name,
      Effect.gen(function* () {
        let discoveries = 0
        const exchanges: URLSearchParams[] = []
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              port: 0,
              async fetch(request) {
                const url = new URL(request.url)
                const issuer = url.origin
                if (url.pathname === "/.well-known/oauth-protected-resource")
                  return Response.json({
                    resource: `${issuer}/mcp`,
                    authorization_servers: [issuer],
                    scopes_supported: ["tools:read"],
                  })
                if (url.pathname === "/.well-known/oauth-authorization-server") {
                  discoveries++
                  return Response.json({
                    issuer,
                    authorization_endpoint: `${issuer}/authorize`,
                    token_endpoint: `${issuer}/token`,
                    response_types_supported: ["code"],
                    scopes_supported: ["tools:read", "offline_access"],
                    code_challenge_methods_supported: ["S256"],
                    authorization_response_iss_parameter_supported: input.supported,
                  })
                }
                if (url.pathname === "/token") {
                  exchanges.push(new URLSearchParams(await request.text()))
                  return Response.json({ access_token: "access", token_type: "Bearer", refresh_token: "refresh" })
                }
                return new Response(null, { status: 404 })
              },
            }),
          ),
          (server) => Effect.sync(() => server.stop(true)),
        )
        const authorization = yield* McpOAuth.authorize({
          name: "test",
          config: new ConfigMCP.Remote({
            type: "remote",
            url: new URL("/mcp", server.url).href,
            oauth: { client_id: "client" },
          }),
          methodID: Integration.MethodID.make("oauth"),
        })
        const url = new URL(authorization.url)
        expect(url.searchParams.get("scope")).toBe("tools:read offline_access")
        expect(url.searchParams.get("prompt")).toBe("consent")
        const callback = new URL(url.searchParams.get("redirect_uri") ?? "")
        const state = url.searchParams.get("state")
        expect(state).toBeTruthy()
        callback.searchParams.set("code", "code")
        callback.searchParams.set("state", input.state ? (state ?? "") : "incorrect")
        if (input.iss !== "missing")
          callback.searchParams.set("iss", input.iss === "matching" ? server.url.origin : "https://other.example.com")
        const response = yield* Effect.promise(() => fetch(callback))
        expect(response.status).toBe(input.state ? 200 : 400)
        const result = yield* Effect.result(authorization.callback)
        expect(discoveries).toBe(1)
        if (!input.state) {
          expect(result).toMatchObject({ _tag: "Failure", failure: { message: "OAuth state mismatch" } })
          expect(exchanges).toHaveLength(0)
          return
        }
        if (input.iss === "mismatch" || (input.iss === "missing" && input.supported)) {
          expect(result).toMatchObject({ _tag: "Failure", failure: expect.any(IssuerMismatchError) })
          expect(exchanges).toHaveLength(0)
          return
        }
        expect(result).toMatchObject({
          _tag: "Success",
          success: { access: "access", metadata: { issuer: server.url.origin } },
        })
        expect(exchanges).toHaveLength(1)
        expect(exchanges[0]?.get("code")).toBe("code")
        expect(exchanges[0]?.get("code_verifier")).toBeTruthy()
      }),
    )
  })
})
