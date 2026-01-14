import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserDoubleClickTool = Tool.define("browser_doubleClick", {
  description: "Double-click on an element by selector",
  parameters: z.object({
    selector: z.string().describe("Selector for element to double-click"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "double_click",
        selector: params.selector,
      },
    })

    await BrowserService.doubleClick(params.selector, params.timeout)

    return {
      title: `Double-clicked element`,
      output: `Double-clicked: ${params.selector}`,
      metadata: {
        selector: params.selector,
      },
    }
  },
})
