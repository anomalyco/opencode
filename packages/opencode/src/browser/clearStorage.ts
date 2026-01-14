import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserClearStorageTool = Tool.define("browser_clearStorage", {
  description: "Clear browser storage (localStorage, sessionStorage, or all)",
  parameters: z.object({
    type: z.enum(["localStorage", "sessionStorage", "all"]).optional().default("all").describe("Storage type to clear"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "clear_storage",
        type: params.type,
      },
    })

    await BrowserService.clearStorage(params.type)

    return {
      title: `Cleared ${params.type}`,
      output: `Cleared ${params.type === 'all' ? 'all storage' : params.type}`,
      metadata: {
        type: params.type,
      },
    }
  },
})
