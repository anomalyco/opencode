import { expect, test } from "bun:test"
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

test("MCP transport does not forward custom headers or request bodies across origins", async () => {
  let forwarded = 0
  const destination = Bun.serve({
    port: 0,
    fetch() {
      forwarded++
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} })
    },
  })
  const source = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 307, headers: { Location: destination.url.toString() } }),
  })
  const transport = new StreamableHTTPClientTransport(source.url, {
    requestInit: { headers: { "X-Test-Credential": "synthetic-only" } },
  })
  try {
    await transport.start()
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" })).rejects.toThrow()
    expect(forwarded).toBe(0)
  } finally {
    await transport.close()
    await source.stop(true)
    await destination.stop(true)
  }
})

test("OAuth code exchange does not forward its body to a different origin", async () => {
  let forwarded = 0
  const destination = Bun.serve({
    port: 0,
    fetch() {
      forwarded++
      return Response.json({ access_token: "synthetic-only", token_type: "Bearer" })
    },
  })
  const source = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin] })
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        })
      }
      return new Response(null, { status: 307, headers: { Location: destination.url.toString() } })
    },
  })
  const provider: OAuthClientProvider = {
    redirectUrl: `${source.url}callback`,
    clientMetadata: { redirect_uris: [`${source.url}callback`] },
    clientInformation: () => ({ client_id: "synthetic-client" }),
    tokens: () => undefined,
    saveTokens: () => {
      throw new Error("Unexpected token persistence")
    },
    redirectToAuthorization: () => {
      throw new Error("Unexpected browser authorization")
    },
    saveCodeVerifier: () => {},
    codeVerifier: () => "synthetic-verifier",
  }
  try {
    await expect(
      auth(provider, { serverUrl: new URL("mcp", source.url), authorizationCode: "synthetic-code" }),
    ).rejects.toThrow()
    expect(forwarded).toBe(0)
  } finally {
    await source.stop(true)
    await destination.stop(true)
  }
})
