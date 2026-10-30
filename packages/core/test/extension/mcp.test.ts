import { describe, expect, it } from "bun:test"
import { UniversalMcpManager } from "../../src/extension/mcp/manager.js"

describe("UniversalMcpManager", () => {
  it("imports Claude Desktop configuration into OpenCode MCP servers", () => {
    const raw = JSON.stringify({
      mcpServers: {
        sqlite: {
          command: "uvx",
          args: ["mcp-server-sqlite", "--db-path", "data.db"],
          env: { SQLITE_DEBUG: "1" },
        },
        remoteApi: {
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "Bearer test" },
        },
      },
    })

    const result = UniversalMcpManager.importClaudeDesktopConfig(raw)
    expect(result.sqlite).toBeDefined()
    expect(result.sqlite.type).toBe("local")
    if (result.sqlite.type === "local") {
      expect(result.sqlite.command).toEqual(["uvx", "mcp-server-sqlite", "--db-path", "data.db"])
      expect(result.sqlite.environment).toEqual({ SQLITE_DEBUG: "1" })
    }

    expect(result.remoteApi).toBeDefined()
    expect(result.remoteApi.type).toBe("remote")
    if (result.remoteApi.type === "remote") {
      expect(result.remoteApi.url).toBe("https://mcp.example.com/sse")
    }
  })

  it("imports Cursor MCP configuration into OpenCode MCP servers", () => {
    const raw = JSON.stringify({
      mcp: {
        servers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
          },
        },
      },
    })

    const result = UniversalMcpManager.importCursorConfig(raw)
    expect(result.filesystem).toBeDefined()
    expect(result.filesystem.type).toBe("local")
    if (result.filesystem.type === "local") {
      expect(result.filesystem.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"])
    }
  })
})
