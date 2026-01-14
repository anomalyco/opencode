import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserAssertTextTool = Tool.define("browser_assertText", {
  description: "Assert that an element's text matches an expected value",
  parameters: z.object({
    selector: z.string().describe("Element selector"),
    expected: z.string().describe("Expected text (or pattern)"),
    contains: z.boolean().optional().default(false).describe("Should contain vs equal"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "assert_text",
        selector: params.selector,
        expected: params.expected,
      },
    })

    const result = await BrowserService.assertText(params.selector, params.expected, params.contains)

    if (!result.passed) {
      throw new Error(`Assertion failed: Expected "${params.contains ? 'containing' : 'equal to'}" "${params.expected}", got "${result.actual}"`)
    }

    return {
      title: `Assertion passed`,
      output: `✓ Text matches: ${params.expected}`,
      metadata: {
        selector: params.selector,
        expected: params.expected,
        actual: result.actual,
        passed: true,
      },
    }
  },
})
