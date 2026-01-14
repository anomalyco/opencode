import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserScrollTopTool = Tool.define("browser_scrollTop", {
  description: "Scroll to the top of the page or an element",
  parameters: z.object({
    selector: z.string().optional().describe("Element (default: page)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "scroll_top",
        selector: params.selector,
      },
    })

    await BrowserService.scrollToTop(params.selector)

    return {
      title: `Scrolled to top`,
      output: params.selector 
        ? `Scrolled ${params.selector} to top`
        : 'Scrolled page to top',
      metadata: {},
    }
  },
})
