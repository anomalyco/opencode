import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserRightClickTool = Tool.define("browser_rightClick", {
  description: "Right-click on an element or at coordinates",
  parameters: z.object({
    selector: z.string().optional().describe("Selector for element (default: current position)"),
    x: z.number().optional().describe("X coordinate (if no selector)"),
    y: z.number().optional().describe("Y coordinate (if no selector)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "right_click",
        selector: params.selector,
      },
    })

    const result = await BrowserService.rightClick(params.selector, params.x, params.y)

    return {
      title: `Right-clicked`,
      output: params.selector 
        ? `Right-clicked element: ${params.selector}`
        : `Right-clicked at coordinates: (${params.x}, ${params.y})`,
      metadata: {},
    }
  },
})
