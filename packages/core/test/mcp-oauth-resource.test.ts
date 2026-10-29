import { expect, test } from "bun:test"
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/client"

test.each([
  ["pathless metadata", "", "/mcp", ""],
  ["explicit root slash", "/", "/mcp", "/"],
  ["parent resource", "/parent", "/parent/mcp", "/parent"],
  ["provider removes transport query", "/mcp?codemode=false", "/mcp", "/mcp"],
  ["provider selects another path", "/mcp", "/mcp", "/canonical"],
  ["rejected metadata", "", "/mcp", "/rejected"],
])("honors custom OAuth resource validation: %s", async (name, metadataPath, serverPath, selectedPath) => {
  const requests: URLSearchParams[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(new URLSearchParams(await request.text()))
      return Response.json({ access_token: "access", token_type: "Bearer" })
    },
  })
  const metadataResource = `${server.url.origin}${metadataPath}`
  const selectedResource = `${server.url.origin}${selectedPath}`
  const redirects: URL[] = []
  const provider: OAuthClientProvider = {
    redirectUrl: "http://127.0.0.1/callback",
    clientMetadata: { redirect_uris: ["http://127.0.0.1/callback"] },
    clientInformation: async () => ({ client_id: "client" }),
    tokens: async () => undefined,
    saveTokens: async () => {},
    saveCodeVerifier: async () => {},
    codeVerifier: async () => "verifier",
    redirectToAuthorization: (url) => void redirects.push(url),
    discoveryState: async () => ({
      authorizationServerUrl: server.url.origin,
      authorizationServerMetadata: {
        issuer: server.url.origin,
        authorization_endpoint: `${server.url.origin}/authorize`,
        token_endpoint: `${server.url.origin}/token`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      },
      resourceMetadata: { resource: metadataResource },
    }),
    validateResourceURL: async () => {
      if (name === "rejected metadata") throw new Error("Rejected resource")
      return new URL(selectedResource)
    },
  }

  try {
    if (name === "rejected metadata") {
      await expect(auth(provider, { serverUrl: `${server.url.origin}${serverPath}` })).rejects.toThrow(
        "Rejected resource",
      )
      expect(redirects).toHaveLength(0)
      expect(requests).toHaveLength(0)
      return
    }
    expect(await auth(provider, { serverUrl: `${server.url.origin}${serverPath}` })).toBe("REDIRECT")
    expect(
      await auth(provider, { serverUrl: `${server.url.origin}${serverPath}`, authorizationCode: "accepted" }),
    ).toBe("AUTHORIZED")
    expect(requests).toHaveLength(1)
    expect({
      authorization: redirects[0]?.searchParams.get("resource"),
      token: requests[0]?.get("resource"),
    }).toEqual({ authorization: selectedResource, token: selectedResource })
  } finally {
    server.stop(true)
  }
})
