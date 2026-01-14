import z from "zod"
import { Tool } from "./tool"
import { ToolRegistry } from "./registry"

export const ToolSearchTool = Tool.define("tool_search", {
  description: `Search for available tools by name or description.
Use this when you need to find a tool for a specific task.
Returns a list of matching tool names that you can then use.`,
  parameters: z.object({
    query: z.string().describe("Regex pattern to search tool names and descriptions"),
  }),
  async execute(params, ctx) {
    const tools = await ToolRegistry.tools("", ctx.extra?.agent)
    const regex = new RegExp(params.query, "i")

    const matches: { id: string; description: string }[] = []
    for (const tool of tools) {
      if (tool.id === "tool_search" || tool.id === "invalid") continue
      if (regex.test(tool.id) || regex.test(tool.description)) {
        matches.push({
          id: tool.id,
          description: tool.description.slice(0, 100),
        })
      }
    }

    if (matches.length === 0) {
      return {
        title: "No tools found",
        metadata: { matches: 0 },
        output: `No tools found matching "${params.query}"`,
      }
    }

    const output = matches
      .map((m) => `- ${m.id}: ${m.description}`)
      .join("\n")

    return {
      title: `Found ${matches.length} tools`,
      metadata: { matches: matches.length, tools: matches.map((m) => m.id) },
      output: `Found ${matches.length} tool(s) matching "${params.query}":\n${output}`,
    }
  },
})
