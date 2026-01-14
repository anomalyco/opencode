import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserReopenTabTool = Tool.define("browser_reopenTab", {
  description: "Reopen a recently closed tab",
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "reopen_tab",
      },
    })

    const result = await BrowserService.reopenTab()

    return {
      title: `Reopened closed tab`,
      output: result.success 
        ? `Reopened closed tab\nURL: ${result.url}\nTitle: ${result.title}`
        : 'No recently closed tabs to reopen',
      metadata: {
        success: result.success,
        url: result.url,
        title: result.title,
      },
    }
  },
})
