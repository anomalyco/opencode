import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserCloseTool = Tool.define("browser_close", {
  description: "Close the browser and all tabs",
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "close",
      },
    })

    const result = await BrowserService.close()

    return {
      title: "Browser closed",
      output: "Browser closed successfully",
      metadata: {},
    }
  },
})
