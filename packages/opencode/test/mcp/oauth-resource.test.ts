import { expect, test } from "bun:test"

import { McpOAuthProvider } from "../../src/mcp/oauth-provider"

test("McpOAuthProvider omits resource and adds offline_access for Entra v2", async () => {
  let captured: URL | undefined

  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    {},
    {
      onRedirect: async (url) => {
        captured = url
      },
    },
  )

  const url = new URL(
    "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?client_id=x&resource=http%3A%2F%2Flocalhost%3A5533%2F&scope=openid",
  )

  await provider.redirectToAuthorization(url)

  expect(captured).toBeDefined()
  expect(captured!.hostname).toBe("login.microsoftonline.com")
  expect(captured!.searchParams.get("resource")).toBeNull()
  expect(captured!.searchParams.get("client_id")).toBe("x")
  expect(captured!.searchParams.get("scope")).toBe("openid offline_access")
})

test("McpOAuthProvider merges configured scope for Entra v2 authorization", async () => {
  let captured: URL | undefined

  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    {
      scope: "api://mcp/.default",
    },
    {
      onRedirect: async (url) => {
        captured = url
      },
    },
  )

  const url = new URL("https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?scope=openid")

  await provider.redirectToAuthorization(url)

  expect(captured).toBeDefined()
  expect(captured!.searchParams.get("scope")).toBe("openid api://mcp/.default offline_access")
})

test("McpOAuthProvider keeps resource for non-v2 Entra endpoints", async () => {
  let captured: URL | undefined

  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    {},
    {
      onRedirect: async (url) => {
        captured = url
      },
    },
  )

  const url = new URL(
    "https://login.microsoftonline.com/tenant/oauth2/authorize?resource=https%3A%2F%2Fgraph.microsoft.com%2F",
  )

  await provider.redirectToAuthorization(url)

  expect(captured).toBeDefined()
  expect(captured!.searchParams.get("resource")).toBe("https://graph.microsoft.com/")
  expect(captured!.searchParams.get("scope")).toBeNull()
})

test("McpOAuthProvider validateResourceURL returns provided resource", async () => {
  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    {},
    {
      onRedirect: async () => {},
    },
  )

  const resource = await provider.validateResourceURL("https://example.com/mcp", "https://graph.microsoft.com/")

  expect(resource?.toString()).toBe("https://graph.microsoft.com/")
})

test("McpOAuthProvider passes configured scope in client metadata", () => {
  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    {
      scope: "openid profile offline_access",
    },
    {
      onRedirect: async () => {},
    },
  )

  expect(provider.clientMetadata.scope).toBe("openid profile offline_access")
})

test("McpOAuthProvider redirectToAuthorization adds only offline_access when URL has no scope", async () => {
  let captured: URL | undefined

  const provider = new McpOAuthProvider("test", "http://localhost:3000", {}, { onRedirect: async (url) => { captured = url } })

  await provider.redirectToAuthorization(
    new URL("https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?client_id=x"),
  )

  expect(captured!.searchParams.get("scope")).toBe("offline_access")
  expect(captured!.searchParams.get("resource")).toBeNull()
})

test("McpOAuthProvider redirectToAuthorization does not modify scope for non-Entra endpoints", async () => {
  let captured: URL | undefined

  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    { scope: "api://mcp/.default" },
    { onRedirect: async (url) => { captured = url } },
  )

  await provider.redirectToAuthorization(
    new URL("https://auth.example.com/authorize?scope=openid&resource=https%3A%2F%2Fapi.example.com"),
  )

  expect(captured!.searchParams.get("scope")).toBe("openid")
  expect(captured!.searchParams.get("resource")).toBe("https://api.example.com")
})

test("McpOAuthProvider addClientAuthentication removes resource and adds client_id for Entra v2", async () => {
  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    { clientId: "my-client" },
    { onRedirect: async () => {} },
  )

  const params = new URLSearchParams({ grant_type: "authorization_code", resource: "https://graph.microsoft.com/" })
  await provider.addClientAuthentication(new Headers(), params, "https://login.microsoftonline.com/tenant/oauth2/v2.0/token")

  expect(params.get("resource")).toBeNull()
  expect(params.get("client_id")).toBe("my-client")
})

test("McpOAuthProvider addClientAuthentication skips client_id if already present for Entra v2", async () => {
  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    { clientId: "my-client" },
    { onRedirect: async () => {} },
  )

  const params = new URLSearchParams({ client_id: "already-set", resource: "https://graph.microsoft.com/" })
  await provider.addClientAuthentication(new Headers(), params, "https://login.microsoftonline.com/tenant/oauth2/v2.0/token")

  expect(params.get("client_id")).toBe("already-set")
  expect(params.get("resource")).toBeNull()
})

test("McpOAuthProvider addClientAuthentication is a no-op for non-Entra v2 endpoints", async () => {
  const provider = new McpOAuthProvider(
    "test",
    "http://localhost:3000",
    { clientId: "my-client" },
    { onRedirect: async () => {} },
  )

  const params = new URLSearchParams({ grant_type: "authorization_code", resource: "https://api.example.com/" })
  await provider.addClientAuthentication(new Headers(), params, "https://auth.example.com/token")

  expect(params.get("resource")).toBe("https://api.example.com/")
  expect(params.has("client_id")).toBe(false)
})

test("McpOAuthProvider validateResourceURL returns undefined when no resource is provided", async () => {
  const provider = new McpOAuthProvider("test", "http://localhost:3000", {}, { onRedirect: async () => {} })

  const result = await provider.validateResourceURL("https://example.com/mcp")

  expect(result).toBeUndefined()
})
