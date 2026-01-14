import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserOpenTool = Tool.define("browser_open", {
  description: "Open a new tab, optionally at a specific URL",
  parameters: z.object({
    url: z.string().describe("URL to open in new tab (optional, opens blank if not provided)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: params.url ? [params.url] : ["*"],
      always: ["*"],
      metadata: {
        url: params.url,
        action: "open",
      },
    })

    const result = await BrowserService.open(params.url)

    return {
      title: `Opened new tab`,
      output: params.url 
        ? `Opened new tab with URL: ${params.url}`
        : `Opened new blank tab`,
      metadata: {
        url: result.url,
        title: result.title,
        id: result.id,
      },
    }
  },
})
