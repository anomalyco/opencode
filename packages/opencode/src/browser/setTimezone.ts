import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserSetTimezoneTool = Tool.define("browser_setTimezone", {
  description: "Set the browser's timezone",
  parameters: z.object({
    timezone: z.string().describe("Timezone ID (e.g., 'America/New_York')"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "set_timezone",
        timezone: params.timezone,
      },
    })

    await BrowserService.setTimezone(params.timezone)

    return {
      title: `Timezone set`,
      output: `Timezone: ${params.timezone}`,
      metadata: {
        timezone: params.timezone,
      },
    }
  },
})
