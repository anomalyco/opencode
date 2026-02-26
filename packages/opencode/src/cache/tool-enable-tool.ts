import z from "zod"
import { Tool } from "@/tool/tool"
import { Cache } from "./cache"

export const ToolEnableTool = Tool.define("cache_enable_tool", async () => {
  const parameters = z.object({
    id: z.string().describe("Tool ID from cache_discover_tool output"),
  })

  return {
    description: "Promote a cached L2 tool to active L1 so it becomes callable immediately.",
    parameters,
    async execute(params) {
      if (!(await Cache.isEnabled())) {
        return {
          title: "",
          output: "Tool discovery cache is not enabled.",
          metadata: {},
        }
      }

      const promoted = await Cache.promoteTool(params.id)
      if (!promoted) {
        return {
          title: "",
          output: `Tool '${params.id}' not found in cache. Use cache_discover_tool first.`,
          metadata: {},
        }
      }

      return {
        title: "",
        output: `Tool '${promoted.name}' is now active. Proceed with your task — it will be available immediately.`,
        metadata: {},
      }
    },
  }
})
