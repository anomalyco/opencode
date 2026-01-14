import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserBackTool = Tool.define("browser_back", {
  description: "Navigate back in browser history",
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "back",
      },
    })

    const result = await BrowserService.back()

    return {
      title: `Went back`,
      output: `Navigated back to: ${result.url}`,
      metadata: {
        url: result.url,
        title: result.title,
      },
    }
  },
})
