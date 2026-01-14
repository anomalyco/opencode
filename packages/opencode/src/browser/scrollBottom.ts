import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserScrollBottomTool = Tool.define("browser_scrollBottom", {
  description: "Scroll to the bottom of the page or an element",
  parameters: z.object({
    selector: z.string().optional().describe("Element (default: page)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "scroll_bottom",
        selector: params.selector,
      },
    })

    await BrowserService.scrollToBottom(params.selector)

    return {
      title: `Scrolled to bottom`,
      output: params.selector 
        ? `Scrolled ${params.selector} to bottom`
        : 'Scrolled page to bottom',
      metadata: {},
    }
  },
})
