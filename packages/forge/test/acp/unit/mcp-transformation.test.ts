import { describe, expect, test } from "bun:test"
import type { McpCapabilities, McpServer } from "@agentclientprotocol/sdk"
import { transformMcpServers } from "../../../src/acp/mcp-transform"
import type { Config } from "../../../src/config/config"

describe("MCP Server Transformation", () => {
  describe("stdio (local) servers", () => {
    test("should transform basic local server to ACP format", () => {
      const config: Record<string, Config.Mcp> = {
        deepwiki: {
          type: "local",
          command: ["npx", "@deepseek/deepwiki"],
        },
      }

      const result = transformMcpServers(config)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        name: "deepwiki",
        command: "npx",
        args: ["@deepseek/deepwiki"],
        env: [],
      })
    })

    test("should transform local server with environment variables", () => {
      const config: Record<string, Config.Mcp> = {
        "gemini-cli": {
          type: "local",
          command: ["npx", "@google/gemini-cli"],
          environment: {
            GEMINI_API_KEY: "test-key-123",
            DEBUG: "true",
          },
        },
      }

      const result = transformMcpServers(config)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: "gemini-cli",
        command: "npx",
        args: ["@google/gemini-cli"],
      })

      // Check environment variables (order may vary)
      const mcpServer = result[0] as Extract<McpServer, { env: unknown }>
      expect(mcpServer.env).toHaveLength(2)
      expect(mcpServer.env).toContainEqual({
        name: "GEMINI_API_KEY",
        value: "test-key-123",
      })
      expect(mcpServer.env).toContainEqual({
        name: "DEBUG",
        value: "true",
      })
    })

    test("should skip disabled local servers", () => {
      const config: Record<string, Config.Mcp> = {
        enabled: {
          type: "local",
          command: ["npx", "enabled-server"],
        },
        disabled: {
          type: "local",
          command: ["npx", "disabled-server"],
          enabled: false,
        },
      }

      const result = transformMcpServers(config)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: "enabled",
        command: "npx",
      })
    })

    test("should handle command with multiple arguments", () => {
      const config: Record<string, Config.Mcp> = {
        custom: {
          type: "local",
          command: ["bun", "run", "server.ts", "--port", "3000"],
        },
      }

      const result = transformMcpServers(config)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        name: "custom",
        command: "bun",
        args: ["run", "server.ts", "--port", "3000"],
        env: [],
      })
    })
  })

  describe("remote servers (HTTP/SSE)", () => {
    test("should transform basic remote server to HTTP format", () => {
      const config: Record<string, Config.Mcp> = {
        posthog: {
          type: "remote",
          url: "https://api.posthog.com/mcp",
        },
      }

      const capabilities: McpCapabilities = {
        http: true,
      }

      const result = transformMcpServers(config, capabilities)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: "http",
        name: "posthog",
        url: "https://api.posthog.com/mcp",
        headers: [],
      })
    })

    test("should transform remote server with headers", () => {
      const config: Record<string, Config.Mcp> = {
        api: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer token-123",
            "X-Custom-Header": "value",
          },
        },
      }

      const capabilities: McpCapabilities = {
        http: true,
      }

      const result = transformMcpServers(config, capabilities)

      expect(result).toHaveLength(1)
      const server = result[0] as Extract<McpServer, { type: "http" }>
      expect(server.type).toBe("http")
      expect(server.name).toBe("api")
      expect(server.url).toBe("https://example.com/mcp")
      expect(server.headers).toHaveLength(2)
      expect(server.headers).toContainEqual({
        name: "Authorization",
        value: "Bearer token-123",
      })
      expect(server.headers).toContainEqual({
        name: "X-Custom-Header",
        value: "value",
      })
    })

    test("should skip disabled remote servers", () => {
      const config: Record<string, Config.Mcp> = {
        enabled: {
          type: "remote",
          url: "https://enabled.com/mcp",
        },
        disabled: {
          type: "remote",
          url: "https://disabled.com/mcp",
          enabled: false,
        },
      }

      const capabilities: McpCapabilities = {
        http: true,
      }

      const result = transformMcpServers(config, capabilities)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: "enabled",
        url: "https://enabled.com/mcp",
      })
    })
  })

  describe("capability filtering", () => {
    test("should exclude HTTP servers when agent lacks http capability", () => {
      const config: Record<string, Config.Mcp> = {
        local: {
          type: "local",
          command: ["npx", "local-server"],
        },
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
        },
      }

      // Agent supports only stdio (no HTTP capability)
      const capabilities: McpCapabilities = {}

      const result = transformMcpServers(config, capabilities)

      // Should only include the local server
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: "local",
        command: "npx",
      })
    })

    test("should include HTTP servers when agent has http capability", () => {
      const config: Record<string, Config.Mcp> = {
        local: {
          type: "local",
          command: ["npx", "local-server"],
        },
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
        },
      }

      const capabilities: McpCapabilities = {
        http: true,
      }

      const result = transformMcpServers(config, capabilities)

      // Should include both servers
      expect(result).toHaveLength(2)
      expect(result.find((s) => "command" in s && s.name === "local")).toBeTruthy()
      expect(result.find((s) => "type" in s && s.type === "http" && s.name === "remote")).toBeTruthy()
    })

    test("should exclude HTTP servers when http capability is explicitly false", () => {
      const config: Record<string, Config.Mcp> = {
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
        },
      }

      const capabilities: McpCapabilities = {
        http: false,
      }

      const result = transformMcpServers(config, capabilities)

      expect(result).toHaveLength(0)
    })

    test("should default to excluding HTTP when no capabilities provided", () => {
      const config: Record<string, Config.Mcp> = {
        local: {
          type: "local",
          command: ["npx", "local-server"],
        },
        remote: {
          type: "remote",
          url: "https://example.com/mcp",
        },
      }

      // No capabilities provided - should only include stdio
      const result = transformMcpServers(config)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        name: "local",
        command: "npx",
      })
    })
  })

  describe("edge cases", () => {
    test("should handle empty config", () => {
      const config: Record<string, Config.Mcp> = {}

      const result = transformMcpServers(config)

      expect(result).toEqual([])
    })

    test("should handle undefined config", () => {
      const result = transformMcpServers(undefined)

      expect(result).toEqual([])
    })

    test("should handle mixed enabled/disabled servers", () => {
      const config: Record<string, Config.Mcp> = {
        server1: {
          type: "local",
          command: ["npx", "server1"],
          enabled: true,
        },
        server2: {
          type: "local",
          command: ["npx", "server2"],
          enabled: false,
        },
        server3: {
          type: "local",
          command: ["npx", "server3"],
          // enabled defaults to true when not specified
        },
      }

      const result = transformMcpServers(config)

      expect(result).toHaveLength(2)
      expect(result.map((s) => s.name).sort()).toEqual(["server1", "server3"])
    })

    test("should preserve server order from config keys", () => {
      const config: Record<string, Config.Mcp> = {
        alpha: {
          type: "local",
          command: ["npx", "alpha"],
        },
        beta: {
          type: "local",
          command: ["npx", "beta"],
        },
        gamma: {
          type: "local",
          command: ["npx", "gamma"],
        },
      }

      const result = transformMcpServers(config)

      expect(result).toHaveLength(3)
      // Order should match the iteration order of the config object
      expect(result[0].name).toBe("alpha")
      expect(result[1].name).toBe("beta")
      expect(result[2].name).toBe("gamma")
    })
  })
})
