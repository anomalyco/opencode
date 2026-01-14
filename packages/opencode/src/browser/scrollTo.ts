import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserScrollToTool = Tool.define("browser_scrollTo", {
  description: "Scroll an element into view",
  parameters: z.object({
    selector: z.string().describe("Selector for element to scroll into view"),
    block: z.enum(["start", "center", "end", "nearest"]).optional().default("center").describe("Scroll alignment"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "scroll_to",
        selector: params.selector,
      },
    })

    await BrowserService.scrollTo(params.selector, params.block)

    return {
      title: `Scrolled to element`,
      output: `Scrolled to: ${params.selector} (block: ${params.block})`,
      metadata: {
        selector: params.selector,
        block: params.block,
      },
    }
  },
})
