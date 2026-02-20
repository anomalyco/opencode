import z from "zod"
import { Tool } from "./tool"
import { MCP } from "../mcp/index"

export const McpRestartTool = Tool.define("mcp_restart", {
  description: "Restart an MCP server by name. Use this tool when an MCP server stops working or the user explicitly asks to restart it.",
  parameters: z.object({
    name: z.string().describe("The name of the MCP server to restart"),
  }),
  async execute(params, ctx) {
    try {
      await MCP.disconnect(params.name)
      await MCP.connect(params.name)
      return {
        title: "mcp_restart",
        metadata: ctx.metadata,
        output: `Successfully restarted MCP server '${params.name}'`
      }
    } catch (error) {
      return {
        title: "mcp_restart",
        metadata: ctx.metadata,
        output: `Failed to restart MCP server '${params.name}': ${error}`
      }
    }
  },
})
