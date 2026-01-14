import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserSetTool = Tool.define("browser_set", {
  description: "Configure browser settings (chromium, firefox, webkit)",
  parameters: z.object({
    browser: z.enum(["chromium", "firefox", "webkit"]).describe("Browser to use"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "set_browser",
        browser: params.browser,
      },
    })

    const config = await BrowserService.getConfig()
    config.browser = params.browser
    
    await BrowserService.close()
    
    return {
      title: `Browser set to ${params.browser}`,
      output: `Browser changed to ${params.browser}. Previous browser was closed.`,
      metadata: {},
    }
  },
})
