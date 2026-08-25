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
})
