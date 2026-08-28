import { afterAll, describe, expect, test } from "bun:test"
import { refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
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
    await expect(authorize("not a URL")).rejects.toThrow("cannot be parsed as a URL")
  })

  test("uses protected resource metadata announced by the MCP challenge", async () => {
    let metadataRequest = ""
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/runtimes/example/invocations")
          return new Response(null, {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/runtimes/example/invocations/.well-known/oauth-protected-resource?qualifier=dev"`,
            },
          })
        if (url.pathname === "/runtimes/example/invocations/.well-known/oauth-protected-resource") {
          metadataRequest = url.href
          return Response.json({
            resource: `${url.origin}/runtimes/example/invocations`,
            authorization_servers: [url.origin],
          })
        }
        if (url.pathname === "/.well-known/oauth-authorization-server")
          return Response.json({
            issuer: url.origin,
            authorization_endpoint: `${url.origin}/authorize`,
            token_endpoint: `${url.origin}/token`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          })
        return new Response(null, { status: 404 })
      },
    })

    try {
      const authorization = await Effect.runPromise(
        Effect.scoped(
          MCPOAuth.authorize({
            name: "aws",
            config: new ConfigMCP.Remote({
              type: "remote",
              url: `${server.url}runtimes/example/invocations?qualifier=dev`,
              oauth: { client_id: "client" },
            }),
            methodID: Integration.MethodID.make("oauth"),
          }),
        ),
      )

      expect(authorization.url).toStartWith(`${server.url}authorize?`)
      expect(metadataRequest).toBe(
        `${server.url}runtimes/example/invocations/.well-known/oauth-protected-resource?qualifier=dev`,
      )
    } finally {
      server.stop(true)
    }
  })
})
