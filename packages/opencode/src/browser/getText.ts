import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserGetTextTool = Tool.define("browser_getText", {
  description: "Get the text content of an element",
  parameters: z.object({
    selector: z.string().describe("Element selector"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "get_text",
        selector: params.selector,
      },
    })

    const result = await BrowserService.getText(params.selector)

    return {
      title: `Got text`,
      output: `Text from ${params.selector}: "${result.text}"`,
      metadata: {
        text: result.text,
        selector: params.selector,
      },
    }
  },
})
