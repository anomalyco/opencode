import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserWaitForURLTool = Tool.define("browser_waitForURL", {
  description: "Wait for the URL to match a pattern",
  parameters: z.object({
    pattern: z.string().describe("URL pattern to match (regex or substring)"),
    timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "wait_for_url",
        pattern: params.pattern,
      },
    })

    const result = await BrowserService.waitForURL(params.pattern, params.timeout)

    return {
      title: `URL ${result.found ? 'matched' : 'not matched'}`,
      output: result.found
        ? `URL matched pattern "${params.pattern}": ${result.url}`
        : `URL "${result.currentUrl}" did not match "${params.pattern}" within ${params.timeout}ms`,
      metadata: {
        pattern: params.pattern,
        url: result.url,
        found: result.found,
      },
    }
  },
})
