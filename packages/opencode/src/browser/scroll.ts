import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserScrollTool = Tool.define("browser_scroll", {
  description: "Scroll the page or an element in a direction",
  parameters: z.object({
    selector: z.string().optional().describe("Element to scroll (default: page)"),
    direction: z.enum(["up", "down", "left", "right"]).default("down").describe("Scroll direction"),
    pixels: z.number().optional().default(300).describe("Pixels to scroll"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "scroll",
        selector: params.selector,
        direction: params.direction,
      },
    })

    await BrowserService.scroll(params.selector, params.direction, params.pixels)

    return {
      title: `Scrolled ${params.direction}`,
      output: `Scrolled ${params.direction} by ${params.pixels}px${params.selector ? ` in ${params.selector}` : ''}`,
      metadata: {
        direction: params.direction,
        pixels: params.pixels,
      },
    }
  },
})
