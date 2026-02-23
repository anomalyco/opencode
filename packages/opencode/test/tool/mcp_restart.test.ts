import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { McpRestartTool } from "../../src/tool/mcp_restart"
import { MCP } from "../../src/mcp/index"

describe("tool.mcp_restart", () => {
  let disconnectMock: any
  let connectMock: any
  let originalDisconnect: any
  let originalConnect: any

  beforeEach(() => {
    originalDisconnect = MCP.disconnect
    originalConnect = MCP.connect
    disconnectMock = mock(async () => {})
    connectMock = mock(async () => {})
    MCP.disconnect = disconnectMock
    MCP.connect = connectMock
  })

  afterEach(() => {
    MCP.disconnect = originalDisconnect
    MCP.connect = originalConnect
  })

  test("successfully restarts an MCP server", async () => {
    const params = { name: "test-server" }
    const ctx = { metadata: { source: "test" }, ask: async () => {} } as any
    const tool = await McpRestartTool.init(ctx)
    
    const result = await tool.execute(params, ctx)
    
    expect(disconnectMock).toHaveBeenCalledWith("test-server")
    expect(connectMock).toHaveBeenCalledWith("test-server")
    expect(result.output).toContain("Successfully restarted")
  })

  test("handles errors during restart", async () => {
    disconnectMock.mockRejectedValue(new Error("Connection error"))
    
    const params = { name: "test-server" }
    const ctx = { metadata: { source: "test" }, ask: async () => {} } as any
    const tool = await McpRestartTool.init(ctx)
    
    const result = await tool.execute(params, ctx)
    
    expect(disconnectMock).toHaveBeenCalledWith("test-server")
    expect(result.output).toContain("Failed to restart")
    expect(result.output).toContain("Connection error")
  })
})
