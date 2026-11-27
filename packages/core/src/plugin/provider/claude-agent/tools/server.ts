export * as ToolServer from "./server.js"

import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider"
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk"
import type { Tool } from "@modelcontextprotocol/server"
import { ToolNames } from "./names.js"
import type { PendingTools } from "./pending.js"

export async function make(
  tools: readonly LanguageModelV3FunctionTool[],
  pending: PendingTools.Interface,
): Promise<McpSdkServerConfigWithInstance> {
  // Loaded on first use, so opencode starts without loading the MCP SDK.
  const { Server } = await import("@modelcontextprotocol/server")
  const server = new Server({ name: "opencode", version: "1.0.0" }, { capabilities: { tools: {} } })
  const definitions = tools.map(
    (tool): Tool => ({
      name: ToolNames.short(tool.name),
      description: ToolNames.description(tool),
      inputSchema: tool.inputSchema as Tool["inputSchema"],
      // Claude serializes non-read-only tools, so each handler takes the ID from the preceding hook.
      annotations: { readOnlyHint: false },
      _meta: { "anthropic/alwaysLoad": true, "anthropic/maxResultSizeChars": 500_000 },
    }),
  )
  server.setRequestHandler("tools/list", async () => ({ tools: definitions }))
  server.setRequestHandler("tools/call", async (request) => {
    const name = ToolNames.PREFIX + request.params.name
    if (!ToolNames.original(name, tools)) throw new Error(`Claude Code called an unregistered OpenCode tool: ${name}`)
    return pending.call(name)
  })
  // Claude Agent SDK bundles its own MCP SDK types; its public instance type also names the higher-level McpServer.
  return { type: "sdk", name: "opencode", instance: server as unknown as McpSdkServerConfigWithInstance["instance"] }
}
