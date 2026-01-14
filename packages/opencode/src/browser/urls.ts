import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserUrlsTool = Tool.define("browser_urls", {
  description: "Get list of all open tabs with their URLs and titles",
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "list_urls",
      },
    })

    const urls = await BrowserService.urls()

    const output = urls.length > 0
      ? urls.map(u => `- ${u.title}: ${u.url}`).join("\n")
      : "No open pages"

    return {
      title: `Open pages (${urls.length})`,
      output,
      metadata: {
        urls,
      },
    }
  },
})
