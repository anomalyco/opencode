import { test, expect, mock } from "bun:test"
import { McpAuth } from "../../src/mcp/auth"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("hasStoredTokens returns true when tokens exist", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.set(
        "has-tokens-server",
        {
          tokens: {
            accessToken: "valid-access-token",
            refreshToken: "valid-refresh-token",
            scope: "read",
          },
        },
        "https://example.com/mcp",
      )

      const { MCP } = await import("../../src/mcp/index")
      const result = await MCP.hasStoredTokens("has-tokens-server")
      expect(result).toBe(true)
    },
  })
})

test("hasStoredTokens returns false when no tokens exist", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // No entry at all
      const { MCP } = await import("../../src/mcp/index")
      const result = await MCP.hasStoredTokens("no-entry-server")
      expect(result).toBe(false)
    },
  })
})

test("hasStoredTokens returns false when entry exists but has no tokens", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await McpAuth.set("no-tokens-server", {
        clientInfo: { clientId: "some-client" },
      })

      const { MCP } = await import("../../src/mcp/index")
      const result = await MCP.hasStoredTokens("no-tokens-server")
      expect(result).toBe(false)
    },
  })
})

test("getAuthStatus returns authenticated for valid non-expired tokens", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600
      await McpAuth.set("auth-valid", {
        tokens: {
          accessToken: "valid-token",
          expiresAt: futureExpiry,
        },
      })

      const { MCP } = await import("../../src/mcp/index")
      const status = await MCP.getAuthStatus("auth-valid")
      expect(status).toBe("authenticated")
    },
  })
})

test("getAuthStatus returns expired for expired tokens", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 3600
      await McpAuth.set("auth-expired", {
        tokens: {
          accessToken: "expired-token",
          expiresAt: pastExpiry,
        },
      })

      const { MCP } = await import("../../src/mcp/index")
      const status = await MCP.getAuthStatus("auth-expired")
      expect(status).toBe("expired")
    },
  })
})

test("getAuthStatus returns not_authenticated when no entry exists", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { MCP } = await import("../../src/mcp/index")
      const status = await MCP.getAuthStatus("nonexistent")
      expect(status).toBe("not_authenticated")
    },
  })
})
