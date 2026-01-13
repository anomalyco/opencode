import z from "zod"
import { Tool } from "./tool"
import { MCP } from "../mcp"
import { Session } from "../session"

export const McpLoadToolsTool = Tool.define("mcp_load_tools", {
  description: `Loads tools from an MCP server, making them available for use in this session.
Call this before using any tools from an MCP server.
Returns the list of loaded tool names so you know what's available.`,
  parameters: z.object({
    serverName: z.string().describe("Name of the MCP server to load tools from"),
    toolNames: z
      .array(z.string())
      .optional()
      .describe("Specific tools to load. If omitted, loads all tools from the server."),
  }),
  async execute(args, ctx) {
    const { serverName, toolNames } = args

    // Load tools from MCP
    const { tools, error } = await MCP.loadToolsForSession(serverName, toolNames)

    if (error) {
      return {
        title: `Failed to load tools from ${serverName}`,
        metadata: {},
        output: `Error: ${error}`,
      }
    }

    if (tools.length === 0) {
      const output = toolNames
        ? `No matching tools found. Requested: ${toolNames.join(", ")}`
        : `Server "${serverName}" has no tools available.`
      return {
        title: `No tools loaded from ${serverName}`,
        metadata: {},
        output,
      }
    }

    // Update session state with loaded tools
    const session = await Session.get(ctx.sessionID)
    const currentLoaded = session.mcpLoadedTools ?? {}
    const serverLoaded = new Set(currentLoaded[serverName] ?? [])

    for (const toolName of tools) {
      serverLoaded.add(toolName)
    }

    await Session.update(ctx.sessionID, (draft) => {
      draft.mcpLoadedTools = {
        ...currentLoaded,
        [serverName]: Array.from(serverLoaded),
      }
    })

    // Format tool names with server prefix for clarity
    const fullToolNames = tools.map((t) => `${serverName}_${t}`)

    return {
      title: `Loaded ${tools.length} tools from ${serverName}`,
      metadata: {},
      output: `Loaded ${tools.length} tools from "${serverName}". You can now use: ${fullToolNames.join(", ")}`,
    }
  },
})
