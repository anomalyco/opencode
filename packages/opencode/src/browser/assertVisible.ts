import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserAssertVisibleTool = Tool.define("browser_assertVisible", {
  description: "Assert that an element is visible or hidden",
  parameters: z.object({
    selector: z.string().describe("Element selector"),
    visible: z.boolean().optional().default(true).describe("Should be visible or hidden"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "assert_visible",
        selector: params.selector,
        visible: params.visible,
      },
    })

    const result = await BrowserService.assertVisible(params.selector, params.visible)

    if (!result.passed) {
      throw new Error(`Assertion failed: Element "${params.selector}" should be ${params.visible ? 'visible' : 'hidden'}`)
    }

    return {
      title: `Assertion passed`,
      output: `✓ Element is ${params.visible ? 'visible' : 'hidden'}: ${params.selector}`,
      metadata: {
        selector: params.selector,
        visible: params.visible,
        passed: true,
      },
    }
  },
})
