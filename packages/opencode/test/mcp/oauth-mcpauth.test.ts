import { test, expect } from "bun:test"
import { McpAuth } from "../../src/mcp/auth"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("updateRedirectUrl persists redirect URL for an MCP server", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateRedirectUrl("test-redirect", "http://my-host:9999/mcp/oauth/callback")

      const entry = await McpAuth.get("test-redirect")
      expect(entry).toBeDefined()
      expect(entry!.redirectUrl).toBe("http://my-host:9999/mcp/oauth/callback")
    },
  })
})

test("updateRedirectUrl preserves other fields when updating", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateTokens(
        "test-preserve",
        {
          accessToken: "some-token",
        },
        "https://example.com/mcp",
      )

      await McpAuth.updateRedirectUrl("test-preserve", "http://new-host:8080/mcp/oauth/callback")

      const entry = await McpAuth.get("test-preserve")
      expect(entry).toBeDefined()
      expect(entry!.redirectUrl).toBe("http://new-host:8080/mcp/oauth/callback")
      expect(entry!.tokens?.accessToken).toBe("some-token")
    },
  })
})

test("clearOAuthState removes oauthState field", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateOAuthState("test-clear-state", "some-oauth-state")

      let entry = await McpAuth.get("test-clear-state")
      expect(entry?.oauthState).toBe("some-oauth-state")

      await McpAuth.clearOAuthState("test-clear-state")

      entry = await McpAuth.get("test-clear-state")
      expect(entry?.oauthState).toBeUndefined()
    },
  })
})

test("clearOAuthState is a no-op when no entry exists", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.clearOAuthState("nonexistent-server")

      const entry = await McpAuth.get("nonexistent-server")
      expect(entry).toBeUndefined()
    },
  })
})

test("getForUrl returns entry when serverUrl matches", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const serverUrl = "https://example.com/mcp"
      await McpAuth.set(
        "test-url-match",
        {
          tokens: { accessToken: "token-abc" },
        },
        serverUrl,
      )

      const entry = await McpAuth.getForUrl("test-url-match", serverUrl)
      expect(entry).toBeDefined()
      expect(entry!.tokens?.accessToken).toBe("token-abc")
    },
  })
})

test("getForUrl returns undefined when serverUrl does not match", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.set(
        "test-url-mismatch",
        {
          tokens: { accessToken: "token-xyz" },
        },
        "https://original.com/mcp",
      )

      const entry = await McpAuth.getForUrl("test-url-mismatch", "https://different.com/mcp")
      expect(entry).toBeUndefined()
    },
  })
})

test("getForUrl returns undefined when entry has no serverUrl", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Set entry without serverUrl
      await McpAuth.set("test-no-server-url", {
        tokens: { accessToken: "token-no-url" },
      })

      const entry = await McpAuth.getForUrl("test-no-server-url", "https://example.com/mcp")
      expect(entry).toBeUndefined()
    },
  })
})

test("updateOAuthState persists and retrieves oauth state", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateOAuthState("test-oauth-state", "abc123hex")

      const entry = await McpAuth.get("test-oauth-state")
      expect(entry?.oauthState).toBe("abc123hex")
    },
  })
})

test("updateCodeVerifier persists code verifier", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateCodeVerifier("test-verifier", "verifier-xyz-789")

      const entry = await McpAuth.get("test-verifier")
      expect(entry?.codeVerifier).toBe("verifier-xyz-789")
    },
  })
})

test("remove deletes the entire entry", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.set(
        "test-remove",
        {
          tokens: { accessToken: "to-remove" },
          clientInfo: { clientId: "remove-client" },
          codeVerifier: "remove-verifier",
          oauthState: "remove-state",
          redirectUrl: "http://remove/mcp/oauth/callback",
        },
        "https://remove.com/mcp",
      )

      await McpAuth.remove("test-remove")

      const entry = await McpAuth.get("test-remove")
      expect(entry).toBeUndefined()
    },
  })
})

test("get returns undefined when no entry exists", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entry = await McpAuth.get("nonexistent-mcp")
      expect(entry).toBeUndefined()
    },
  })
})

test("updateTokens preserves other fields", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateClientInfo(
        "test-tokens-preserve",
        {
          clientId: "client-abc",
        },
        "https://example.com/mcp",
      )

      await McpAuth.updateTokens("test-tokens-preserve", {
        accessToken: "new-token",
        refreshToken: "new-refresh",
        scope: "read",
      })

      const entry = await McpAuth.get("test-tokens-preserve")
      expect(entry?.tokens?.accessToken).toBe("new-token")
      expect(entry?.tokens?.refreshToken).toBe("new-refresh")
      expect(entry?.tokens?.scope).toBe("read")
      expect(entry?.clientInfo?.clientId).toBe("client-abc")
    },
  })
})
