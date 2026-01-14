import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserGetPageSourceTool = Tool.define("browser_getPageSource", {
  description: "Get the HTML source of the current page",
  parameters: z.object({
    trimmed: z.boolean().optional().default(true).describe("Trim whitespace"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "get_page_source",
      },
    })

    const result = await BrowserService.getPageSource(params.trimmed)

    return {
      title: `Got page source`,
      output: `Page source: ${result.source.length} characters`,
      metadata: {
        source: result.source,
        length: result.source.length,
      },
    }
  },
})
