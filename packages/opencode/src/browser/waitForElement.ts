import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserWaitForElementTool = Tool.define("browser_waitForElement", {
  description: "Wait for an element to appear or disappear",
  parameters: z.object({
    selector: z.string().describe("Selector to wait for"),
    state: z.enum(["attached", "detached", "visible", "hidden"]).optional().default("attached").describe("Element state"),
    timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "wait_for_element",
        selector: params.selector,
      },
    })

    const result = await BrowserService.waitForElement(params.selector, params.state, params.timeout)

    return {
      title: `Element ${result.found ? 'found' : 'not found'}`,
      output: result.found 
        ? `Element ${params.selector} is ${params.state}`
        : `Element ${params.selector} not found within ${params.timeout}ms`,
      metadata: {
        selector: params.selector,
        state: params.state,
        found: result.found,
      },
    }
  },
})
