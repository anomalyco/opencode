import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserClearTool = Tool.define("browser_clear", {
  description: "Clear an input field",
  parameters: z.object({
    selector: z.string().describe("Input element selector"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "clear",
        selector: params.selector,
      },
    })

    await BrowserService.clear(params.selector)

    return {
      title: `Cleared input`,
      output: `Cleared: ${params.selector}`,
      metadata: {
        selector: params.selector,
      },
    }
  },
})
