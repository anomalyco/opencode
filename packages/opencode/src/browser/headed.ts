import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserHeadedTool = Tool.define("browser_headed", {
  description: "Toggle headed mode (visible browser window)",
  parameters: z.object({
    enabled: z.boolean().optional().default(true).describe("Enable or disable headed mode"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "set_headed",
        enabled: params.enabled,
      },
    })

    const config = await BrowserService.getConfig()
    config.headed = params.enabled
    
    await BrowserService.close()
    
    return {
      title: `Headed mode ${params.enabled ? 'enabled' : 'disabled'}`,
      output: params.enabled 
        ? `Headed mode enabled. Browser will now be visible. Run browser_navigate to open the browser.`
        : `Headed mode disabled. Browser will run in headless mode.`,
      metadata: {
        headed: params.enabled,
      },
    }
  },
})
