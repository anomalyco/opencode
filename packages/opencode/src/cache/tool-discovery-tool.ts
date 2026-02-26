import z from "zod"
import { Tool } from "@/tool/tool"
import { Cache } from "./cache"
import { Discover } from "./discover"

function xml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

export const ToolDiscoveryTool = Tool.define("cache_discover_tool", async () => {
  const parameters = z.object({
    query: z.string().describe("Natural language description of the tool you need"),
    top_k: z.number().int().positive().max(20).optional().describe("Maximum number of results to return"),
  })

  return {
    description: "Search cached L2 tools and return candidates to activate with cache_enable_tool.",
    parameters,
    async execute(params) {
      if (!(await Cache.isEnabled())) {
        return {
          title: "",
          output: "Tool discovery cache is not enabled.",
          metadata: {},
        }
      }

      const rows = await Cache.l2ToolRows()
      const tools = await Discover.tools(params.query, params.top_k ?? 5, rows)
      const output = [
        "<cached_tools>",
        ...tools.flatMap((item) => [
          `  <tool id=\"${xml(item.id)}\">`,
          `    <name>${xml(item.name)}</name>`,
          `    <description>${xml(item.description)}</description>`,
          `    <schema>${xml(item.schema_json)}</schema>`,
          "  </tool>",
        ]),
        "</cached_tools>",
        "Use cache_enable_tool to activate a tool, then proceed with your task.",
      ].join("\n")

      return {
        title: "",
        output,
        metadata: {},
      }
    },
  }
})
