import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserSetUserAgentTool = Tool.define("browser_setUserAgent", {
  description: "Set the browser's user agent string",
  parameters: z.object({
    userAgent: z.string().describe("User agent string to use"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "set_user_agent",
        userAgent: params.userAgent,
      },
    })

    await BrowserService.setUserAgent(params.userAgent)

    return {
      title: `User agent set`,
      output: `User agent: ${params.userAgent}`,
      metadata: {
        userAgent: params.userAgent,
      },
    }
  },
})
