import { afterAll, describe, expect, test } from "bun:test"
import { refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
import { Integration } from "@opencode-ai/core/integration"
import { MCPOAuth } from "@opencode-ai/core/mcp/oauth"
import { Effect } from "effect"

const authServer = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
afterAll(() => authServer.stop(true))

const authorize = (redirect_uri?: string) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const authorization = yield* MCPOAuth.authorize({
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

  test("follows the resource_metadata URL from the 401 challenge", async () => {
    const issuer = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        if (url.pathname === "/.well-known/oauth-authorization-server")
          return Response.json({
            issuer: url.origin + "/",
            authorization_endpoint: `${url.origin}/authorize`,
            token_endpoint: `${url.origin}/token`,
            response_types_supported: ["code"],
          })
        return new Response(null, { status: 404 })
      },
    })

    // Path-shaped metadata that only the WWW-Authenticate challenge names; the origin-derived
    // well-known lookups 404, so without the challenge URL discovery treats this host as the AS.
    const resource = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        const endpoint = "/runtimes/arn%3Atest/invocations"
        if (url.pathname === `${endpoint}/.well-known/oauth-protected-resource`)
          return Response.json({ resource: url.origin + endpoint, authorization_servers: [issuer.url.href] })
        if (url.pathname === endpoint)
          return new Response(null, {
            status: 401,
            headers: {
              "www-authenticate": `Bearer resource_metadata="${url.origin}${endpoint}/.well-known/oauth-protected-resource"`,
            },
          })
        return new Response(null, { status: 404 })
      },
    })

    const authorization = await Effect.runPromise(
      Effect.scoped(
        MCPOAuth.authorize({
          name: "test",
          config: new ConfigMCP.Remote({
            type: "remote",
            url: `${resource.url.href}runtimes/arn%3Atest/invocations`,
            oauth: { client_id: "client" },
          }),
          methodID: Integration.MethodID.make("oauth"),
        }).pipe(Effect.map((result) => new URL(result.url))),
      ),
    )

    expect(authorization.origin).toBe(issuer.url.origin)
    expect(authorization.pathname).toBe("/authorize")

    resource.stop(true)
    issuer.stop(true)
  })
})
