import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserDuplicateTabTool = Tool.define("browser_duplicateTab", {
  description: "Duplicate the current tab",
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "duplicate_tab",
      },
    })

    const result = await BrowserService.duplicateTab()

    return {
      title: `Duplicated tab`,
      output: `Duplicated current tab\nNew tab: ${result.url}\nTitle: ${result.title}`,
      metadata: {
        url: result.url,
        title: result.title,
        newIndex: result.newIndex,
      },
    }
  },
})
