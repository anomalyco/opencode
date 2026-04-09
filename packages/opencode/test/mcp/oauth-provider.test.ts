import { test, expect } from "bun:test"
import { McpOAuthProvider } from "../../src/mcp/oauth-provider"
import { McpAuth } from "../../src/mcp/auth"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("redirectUrl defaults to localhost callback URL when not provided", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-default",
        "https://example.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
      )

      expect(provider.redirectUrl).toBe("http://127.0.0.1:19876/mcp/oauth/callback")
    },
  })
})

test("redirectUrl uses custom URL when provided", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const customUrl = "http://my-host:9999/mcp/oauth/callback"
      const provider = new McpOAuthProvider(
        "test-custom-redirect",
        "https://example.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
        customUrl,
      )

      expect(provider.redirectUrl).toBe(customUrl)
    },
  })
})

test("clientInformation returns config clientId when provided", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-config-client",
        "https://example.com/mcp",
        {
          clientId: "pre-registered-client-id",
          clientSecret: "secret",
        },
        {
          onRedirect: async () => {},
        },
      )

      const info = await provider.clientInformation()
      expect(info).toBeDefined()
      expect(info!.client_id).toBe("pre-registered-client-id")
      expect(info!.client_secret).toBe("secret")
    },
  })
})

test("clientInformation returns undefined when no stored info exists", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-no-client-info",
        "https://example.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
      )

      const info = await provider.clientInformation()
      expect(info).toBeUndefined()
    },
  })
})

test("clientInformation returns stored client info when serverUrl matches and redirectUrl matches", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const serverUrl = "https://example.com/mcp"
      const redirectUrl = "http://127.0.0.1:19876/mcp/oauth/callback"
      await McpAuth.set(
        "test-matched-url",
        {
          clientInfo: { clientId: "stored-client-id", clientSecret: "stored-secret" },
          redirectUrl,
        },
        serverUrl,
      )

      const provider = new McpOAuthProvider(
        "test-matched-url",
        serverUrl,
        {},
        {
          onRedirect: async () => {},
        },
      )

      const info = await provider.clientInformation()
      expect(info).toBeDefined()
      expect(info!.client_id).toBe("stored-client-id")
    },
  })
})

test("clientInformation returns undefined when serverUrl does not match", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.updateClientInfo(
        "test-mismatched-url",
        {
          clientId: "old-client-id",
          clientSecret: "old-secret",
        },
        "https://old-server.com/mcp",
      )

      const provider = new McpOAuthProvider(
        "test-mismatched-url",
        "https://new-server.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
      )

      const info = await provider.clientInformation()
      expect(info).toBeUndefined()
    },
  })
})

test("clientInformation clears stale clientInfo when redirectUrl changed and no tokens exist", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const serverUrl = "https://example.com/mcp"
      // Store clientInfo with an old redirectUrl
      await McpAuth.set(
        "test-stale-redirect",
        {
          clientInfo: {
            clientId: "stale-client-id",
            clientSecret: "stale-secret",
          },
          redirectUrl: "http://old-host:19876/mcp/oauth/callback",
        },
        serverUrl,
      )

      // Verify it was stored
      const entryBefore = await McpAuth.get("test-stale-redirect")
      expect(entryBefore?.clientInfo).toBeDefined()
      expect(entryBefore?.redirectUrl).toBe("http://old-host:19876/mcp/oauth/callback")

      // Now create a provider with a different redirectUrl
      const provider = new McpOAuthProvider(
        "test-stale-redirect",
        serverUrl,
        {},
        {
          onRedirect: async () => {},
        },
        "http://new-host:19876/mcp/oauth/callback",
      )

      const info = await provider.clientInformation()
      // Should return undefined because redirectUrl changed and no tokens
      expect(info).toBeUndefined()

      // Should have cleared the stale clientInfo
      const entryAfter = await McpAuth.get("test-stale-redirect")
      expect(entryAfter?.clientInfo).toBeUndefined()
    },
  })
})

test("clientInformation preserves clientInfo when tokens exist even if redirectUrl changed", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const serverUrl = "https://example.com/mcp"
      // Store clientInfo AND tokens with an old redirectUrl
      await McpAuth.set(
        "test-preserve-with-tokens",
        {
          clientInfo: {
            clientId: "preserved-client-id",
            clientSecret: "preserved-secret",
          },
          tokens: {
            accessToken: "valid-token",
            refreshToken: "refresh-token",
            scope: "read",
          },
          redirectUrl: "http://old-host:19876/mcp/oauth/callback",
        },
        serverUrl,
      )

      // Create a provider with a different redirectUrl
      const provider = new McpOAuthProvider(
        "test-preserve-with-tokens",
        serverUrl,
        {},
        {
          onRedirect: async () => {},
        },
        "http://new-host:19876/mcp/oauth/callback",
      )

      const info = await provider.clientInformation()
      // Should return the stored clientInfo because tokens exist
      expect(info).toBeDefined()
      expect(info!.client_id).toBe("preserved-client-id")

      // Should NOT have cleared clientInfo
      const entry = await McpAuth.get("test-preserve-with-tokens")
      expect(entry?.clientInfo).toBeDefined()
    },
  })
})

test("saveClientInformation persists redirectUrl", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const serverUrl = "https://example.com/mcp"
      const redirectUrl = "http://my-host:9999/mcp/oauth/callback"
      const provider = new McpOAuthProvider(
        "test-save-redirect",
        serverUrl,
        {},
        {
          onRedirect: async () => {},
        },
        redirectUrl,
      )

      await provider.saveClientInformation({
        client_id: "new-client-id",
        client_secret: "new-secret",
        client_id_issued_at: 1234567890,
        client_secret_expires_at: undefined,
        redirect_uris: [provider.redirectUrl],
      })

      const entry = await McpAuth.get("test-save-redirect")
      expect(entry?.clientInfo?.clientId).toBe("new-client-id")
      expect(entry?.redirectUrl).toBe(redirectUrl)
      expect(entry?.serverUrl).toBe(serverUrl)
    },
  })
})

test("tokens returns undefined when no entry exists", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-no-tokens",
        "https://example.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
      )

      const tokens = await provider.tokens()
      expect(tokens).toBeUndefined()
    },
  })
})

test("tokens returns stored tokens when serverUrl matches", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const serverUrl = "https://example.com/mcp"
      const expiresAt = Math.floor(Date.now() / 1000) + 3600
      await McpAuth.set(
        "test-has-tokens",
        {
          tokens: {
            accessToken: "valid-access",
            refreshToken: "valid-refresh",
            expiresAt,
            scope: "read write",
          },
        },
        serverUrl,
      )

      const provider = new McpOAuthProvider(
        "test-has-tokens",
        serverUrl,
        {},
        {
          onRedirect: async () => {},
        },
      )

      const tokens = await provider.tokens()
      expect(tokens).toBeDefined()
      expect(tokens!.access_token).toBe("valid-access")
      expect(tokens!.refresh_token).toBe("valid-refresh")
      expect(tokens!.scope).toBe("read write")
      expect(tokens!.token_type).toBe("Bearer")
    },
  })
})

test("tokens returns undefined when serverUrl does not match", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.set(
        "test-tokens-mismatch",
        {
          tokens: {
            accessToken: "valid-access",
          },
        },
        "https://old-server.com/mcp",
      )

      const provider = new McpOAuthProvider(
        "test-tokens-mismatch",
        "https://new-server.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
      )

      const tokens = await provider.tokens()
      expect(tokens).toBeUndefined()
    },
  })
})

test("invalidateCredentials type=client removes clientInfo but keeps tokens", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-invalidate-client",
        "https://example.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
      )

      await McpAuth.set("test-invalidate-client", {
        clientInfo: { clientId: "client-123", clientSecret: "secret-123" },
        tokens: { accessToken: "token-123" },
      })

      await provider.invalidateCredentials("client")

      const entry = await McpAuth.get("test-invalidate-client")
      expect(entry?.clientInfo).toBeUndefined()
      expect(entry?.tokens).toBeDefined()
    },
  })
})

test("invalidateCredentials type=tokens removes tokens but keeps clientInfo", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-invalidate-tokens",
        "https://example.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
      )

      await McpAuth.set("test-invalidate-tokens", {
        clientInfo: { clientId: "client-456" },
        tokens: { accessToken: "token-456" },
      })

      await provider.invalidateCredentials("tokens")

      const entry = await McpAuth.get("test-invalidate-tokens")
      expect(entry?.clientInfo).toBeDefined()
      expect(entry?.tokens).toBeUndefined()
    },
  })
})

test("invalidateCredentials type=all removes the entire entry", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-invalidate-all",
        "https://example.com/mcp",
        {},
        {
          onRedirect: async () => {},
        },
      )

      await McpAuth.set("test-invalidate-all", {
        clientInfo: { clientId: "client-789" },
        tokens: { accessToken: "token-789" },
      })

      await provider.invalidateCredentials("all")

      const entry = await McpAuth.get("test-invalidate-all")
      expect(entry).toBeUndefined()
    },
  })
})
