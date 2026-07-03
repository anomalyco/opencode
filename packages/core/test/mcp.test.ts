import { describe, expect, test } from "bun:test"
import { MCP } from "@opencode-ai/core/mcp/index"
import { MCPClient } from "@opencode-ai/core/mcp/client"

describe("MCP errors", () => {
  test("expose useful messages", () => {
    expect(new MCP.NotFoundError({ server: MCP.ServerName.make("demo") }).message).toBe("MCP server not found: demo")
    expect(new MCP.ToolCallError({ server: MCP.ServerName.make("demo"), tool: "search", message: "failed" }).message).toBe(
      "failed",
    )
    expect(new MCPClient.NeedsAuthError({ server: "demo" }).message).toBe("MCP server requires authentication: demo")
    expect(new MCPClient.ConnectError({ server: "demo", message: "offline" }).message).toBe("offline")
  })
})
