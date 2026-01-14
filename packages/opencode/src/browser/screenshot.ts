import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserScreenshotTool = Tool.define("browser_screenshot", {
  description: "Take a screenshot of the current page",
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "screenshot",
      },
    })

    const result = await BrowserService.screenshot()

    return {
      title: `Screenshot (${result.width}x${result.height})`,
      output: `Screenshot captured\nDimensions: ${result.width}x${result.height}\nSize: ${result.size} bytes`,
      metadata: {
        screenshot: result.base64,
        width: result.width,
        height: result.height,
        size: result.size,
      },
    }
  },
})
