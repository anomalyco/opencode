import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserAssertURLTool = Tool.define("browser_assertURL", {
  description: "Assert that the current URL matches a pattern",
  parameters: z.object({
    pattern: z.string().describe("URL pattern to match (substring or regex)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "assert_url",
        pattern: params.pattern,
      },
    })

    const result = await BrowserService.assertURL(params.pattern)

    if (!result.passed) {
      throw new Error(`Assertion failed: URL "${result.currentUrl}" does not match "${params.pattern}"`)
    }

    return {
      title: `Assertion passed`,
      output: `✓ URL matches: ${params.pattern}`,
      metadata: {
        pattern: params.pattern,
        url: result.url,
        passed: true,
      },
    }
  },
})
