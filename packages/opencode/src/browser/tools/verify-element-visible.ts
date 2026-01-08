import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Verify that an element is visible on the page.

Checks if an element matching the selector is visible (not hidden, not display:none, etc).
Useful for testing and validation.

Parameters:
- selector (string, required): CSS selector or description of the element
- timeout (number, optional): Maximum time to wait for the element in milliseconds (default: 5000)
- should_exist (boolean, optional): If true, verify element exists and is visible. If false, verify it does NOT exist or is hidden (default: true)
`

export const BrowserVerifyElementVisibleTool = Tool.define("browser_verify_element_visible", {
  description: DESCRIPTION,
  parameters: z.object({
    selector: z.string().describe("CSS selector or description of the element"),
    timeout: z.number().default(5000).describe("Maximum time to wait for the element"),
    should_exist: z
      .boolean()
      .default(true)
      .describe("If true, verify element exists and is visible. If false, verify it does NOT exist"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["verify_element_visible"],
      always: ["*"],
      metadata: { action: "verify_element_visible", selector: params.selector },
    })

    log.info("verifying element visible", { selector: params.selector, shouldExist: params.should_exist })

    try {
      const result = await BrowserManager.verifyElementVisible({ selector: params.selector })
      const isVisible = result?.visible === true

      if (params.should_exist) {
        if (isVisible) {
          return {
            title: "✓ Element is visible",
            metadata: { selector: params.selector, visible: true, passed: true },
            output: `PASSED: Element "${params.selector}" is visible on the page`,
          }
        } else {
          return {
            title: "✗ Element not visible",
            metadata: { selector: params.selector, visible: false, passed: false },
            output: `FAILED: Element "${params.selector}" is not visible or does not exist`,
          }
        }
      } else {
        if (!isVisible) {
          return {
            title: "✓ Element not visible (as expected)",
            metadata: { selector: params.selector, visible: false, passed: true },
            output: `PASSED: Element "${params.selector}" is not visible (as expected)`,
          }
        } else {
          return {
            title: "✗ Element unexpectedly visible",
            metadata: { selector: params.selector, visible: true, passed: false },
            output: `FAILED: Element "${params.selector}" is visible but should not be`,
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("verify element visible failed", { error: message })
      throw new Error(`Verification failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserVerifyElementVisibleTool)
