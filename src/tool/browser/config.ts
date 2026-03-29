import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"

export const BrowserConfigTool = Tool.define("browser_config", {
  description: `Configure browser settings for the current session:

- "viewport": Set browser window size
- "device": Emulate a device (e.g., "iPhone 15", "iPad Pro")
- "geolocation": Set fake GPS location
- "offline": Toggle offline mode
- "colorscheme": Set dark/light mode
- "headers": Set custom HTTP headers
- "auth": Set HTTP basic auth credentials`,
  parameters: z.object({
    setting: z.enum(["viewport", "device", "geolocation", "offline", "colorscheme", "headers", "auth"]).describe("Setting to configure."),
    value: z.string().describe("Value for the setting. Examples: viewport='1920 1080', device='iPhone 15', geolocation='37.7749 -122.4194', offline='true', colorscheme='dark', headers='{\"X-Custom\":\"value\"}', auth='user pass'"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_config",
      patterns: [params.setting],
      always: ["viewport", "colorscheme"],
      metadata: { setting: params.setting, value: params.value },
    })

    ctx.metadata({ title: `Setting ${params.setting}` })

    const args = ["set", params.setting, ...params.value.split(" ")]
    const result = await BrowserClient.exec(ctx.sessionID, args, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Set ${params.setting} failed: ${result.error || result.output}`)
    }

    return {
      title: `Set ${params.setting}`,
      metadata: { setting: params.setting },
      output: `Set ${params.setting} to "${params.value}"`,
    }
  },
})
