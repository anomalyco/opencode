import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Verify that specific text is visible on the page.

Checks if the specified text appears anywhere on the visible page.
Useful for testing and validation.

Parameters:
- text (string, required): The text to search for
- exact (boolean, optional): If true, match exact text. If false, partial match (default: false)
- case_sensitive (boolean, optional): If true, match is case-sensitive (default: false)
- should_exist (boolean, optional): If true, verify text exists. If false, verify it does NOT exist (default: true)
`

export const BrowserVerifyTextVisibleTool = Tool.define("browser_verify_text_visible", {
  description: DESCRIPTION,
  parameters: z.object({
    text: z.string().describe("The text to search for"),
    exact: z.boolean().default(false).describe("If true, match exact text"),
    case_sensitive: z.boolean().default(false).describe("If true, match is case-sensitive"),
    should_exist: z.boolean().default(true).describe("If true, verify text exists. If false, verify it does NOT exist"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["verify_text_visible"],
      always: ["*"],
      metadata: { action: "verify_text_visible", textLength: params.text.length },
    })

    log.info("verifying text visible", { text: params.text.slice(0, 50), shouldExist: params.should_exist })

    try {
      const result = await BrowserManager.verifyTextVisible(params.text)
      const isFound = result?.visible === true

      const displayText = params.text.length > 50 ? params.text.slice(0, 47) + "..." : params.text

      if (params.should_exist) {
        if (isFound) {
          return {
            title: "✓ Text found",
            metadata: { text: params.text, found: true, passed: true },
            output: `PASSED: Text "${displayText}" is visible on the page`,
          }
        } else {
          return {
            title: "✗ Text not found",
            metadata: { text: params.text, found: false, passed: false },
            output: `FAILED: Text "${displayText}" was not found on the page`,
          }
        }
      } else {
        if (!isFound) {
          return {
            title: "✓ Text not found (as expected)",
            metadata: { text: params.text, found: false, passed: true },
            output: `PASSED: Text "${displayText}" is not on the page (as expected)`,
          }
        } else {
          return {
            title: "✗ Text unexpectedly found",
            metadata: { text: params.text, found: true, passed: false },
            output: `FAILED: Text "${displayText}" was found but should not be`,
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("verify text visible failed", { error: message })
      throw new Error(`Verification failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserVerifyTextVisibleTool)
