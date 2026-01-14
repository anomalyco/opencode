import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserGetCSSTool = Tool.define("browser_getCSS", {
  description: "Get a CSS property value from an element",
  parameters: z.object({
    selector: z.string().describe("Element selector"),
    property: z.string().describe("CSS property name"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "get_css",
        selector: params.selector,
        property: params.property,
      },
    })

    const result = await BrowserService.getCSS(params.selector, params.property)

    return {
      title: `Got CSS value`,
      output: `${params.property} of ${params.selector}: "${result.value}"`,
      metadata: {
        property: params.property,
        value: result.value,
        selector: params.selector,
      },
    }
  },
})
