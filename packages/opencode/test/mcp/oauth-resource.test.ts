import { expect, test } from "bun:test"

import { McpOAuthProvider } from "../../src/mcp/oauth-provider"

test("McpOAuthProvider omits resource for login.microsoftonline.com", async () => {
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
  expect(captured!.searchParams.get("scope")).toBe("openid")
})
