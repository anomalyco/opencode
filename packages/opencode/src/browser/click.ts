import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserClickTool = Tool.define("browser_click", {
  description: "Click on an element by selector",
  parameters: z.object({
    selector: z.string().describe("Selector to identify the element to click"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 10000)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        selector: params.selector,
        action: "click",
      },
    })

    const result = await BrowserService.click(params.selector, {
      elementTimeoutMs: params.timeout,
    })

    return {
      title: `Clicked element on ${result.url}`,
      output: `Successfully clicked element\nPage URL: ${result.url}\nPage title: ${result.title}`,
      metadata: {},
    }
  },
})
