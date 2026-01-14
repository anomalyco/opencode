import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserForwardTool = Tool.define("browser_forward", {
  description: "Navigate forward in browser history",
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "forward",
      },
    })

    const result = await BrowserService.forward()

    return {
      title: `Went forward`,
      output: `Navigated forward to: ${result.url}`,
      metadata: {
        url: result.url,
        title: result.title,
      },
    }
  },
})
