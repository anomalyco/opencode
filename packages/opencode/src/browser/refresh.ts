import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserRefreshTool = Tool.define("browser_refresh", {
  description: "Refresh the current page",
  parameters: z.object({
    bypassCache: z.boolean().optional().default(false).describe("Bypass cache when reloading"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "refresh",
        bypassCache: params.bypassCache,
      },
    })

    const result = await BrowserService.refresh(params.bypassCache)

    return {
      title: `Refreshed page`,
      output: `Refreshed: ${result.url}`,
      metadata: {
        url: result.url,
        title: result.title,
      },
    }
  },
})
