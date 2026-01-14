import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserHoverTool = Tool.define("browser_hover", {
  description: "Hover over an element by selector",
  parameters: z.object({
    selector: z.string().describe("Selector for element to hover over"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "hover",
        selector: params.selector,
      },
    })

    const result = await BrowserService.hover(params.selector, params.timeout)

    return {
      title: `Hovered over element`,
      output: `Successfully hovered over: ${params.selector}`,
      metadata: {
        selector: params.selector,
      },
    }
  },
})
