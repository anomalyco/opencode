import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserGetAttributeTool = Tool.define("browser_getAttribute", {
  description: "Get an attribute value from an element",
  parameters: z.object({
    selector: z.string().describe("Element selector"),
    attribute: z.string().describe("Attribute name to get"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "get_attribute",
        selector: params.selector,
        attribute: params.attribute,
      },
    })

    const result = await BrowserService.getAttribute(params.selector, params.attribute)

    return {
      title: `Got attribute`,
      output: `${params.attribute} of ${params.selector}: "${result.value}"`,
      metadata: {
        attribute: params.attribute,
        value: result.value,
        selector: params.selector,
      },
    }
  },
})
