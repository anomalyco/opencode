import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserGetCookiesTool = Tool.define("browser_getCookies", {
  description: "Get all cookies, optionally filtered by domain",
  parameters: z.object({
    domain: z.string().optional().describe("Filter by domain"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "get_cookies",
        domain: params.domain,
      },
    })

    const result = await BrowserService.getCookies(params.domain)

    return {
      title: `Got ${result.cookies.length} cookies`,
      output: result.cookies.length > 0 
        ? result.cookies.map(c => `${c.name}=${c.value}`).join('\n')
        : 'No cookies',
      metadata: {
        cookies: result.cookies,
        count: result.cookies.length,
      },
    }
  },
})
