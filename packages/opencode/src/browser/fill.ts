import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserFillTool = Tool.define("browser_fill", {
  description: "Fill an input field with text",
  parameters: z.object({
    selector: z.string().describe("Selector to identify the input element"),
    value: z.string().describe("Value to fill into the input field"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 10000)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        selector: params.selector,
        value: params.value,
        action: "fill",
      },
    })

    const result = await BrowserService.fill(params.selector, params.value, {
      elementTimeoutMs: params.timeout,
    })

    return {
      title: `Filled form field`,
      output: `Successfully filled "${params.selector}" with value: ${params.value}`,
      metadata: {},
    }
  },
})
