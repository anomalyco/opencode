import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserCloseTabTool = Tool.define("browser_closeTab", {
  description: "Close a tab by index, or the current tab if no index specified",
  parameters: z.object({
    index: z.number().optional().describe("Tab index to close (default: current tab)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "close_tab",
        index: params.index,
      },
    })

    const result = await BrowserService.closeTab(params.index)

    return {
      title: `Closed tab ${params.index ?? 'current'}`,
      output: `Closed tab at index ${params.index ?? 'current'}\nRemaining tabs: ${result.remaining}`,
      metadata: {
        remaining: result.remaining,
        closedIndex: params.index,
      },
    }
  },
})
