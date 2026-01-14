import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserGetValueTool = Tool.define("browser_getValue", {
  description: "Get the value of an input element",
  parameters: z.object({
    selector: z.string().describe("Element selector"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "get_value",
        selector: params.selector,
      },
    })

    const result = await BrowserService.getValue(params.selector)

    return {
      title: `Got value`,
      output: `Value of ${params.selector}: "${result.value}"`,
      metadata: {
        value: result.value,
        selector: params.selector,
      },
    }
  },
})
