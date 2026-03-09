import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Generate a robust locator/selector for an element.

Analyzes an element and generates the best selector to locate it.
Returns multiple selector options ranked by robustness.

Parameters:
- description (string, required): Description of the element to find (e.g., "the login button", "email input field")
- prefer (string, optional): Preferred selector type (css, xpath, text, role, testid)
`

export const BrowserGenerateLocatorTool = Tool.define("browser_generate_locator", {
  description: DESCRIPTION,
  parameters: z.object({
    description: z.string().describe("Description of the element to find"),
    prefer: z.enum(["css", "xpath", "text", "role", "testid"]).optional().describe("Preferred selector type"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["generate_locator"],
      always: ["*"],
      metadata: { action: "generate_locator", description: params.description },
    })

    log.info("generating locator", { description: params.description, prefer: params.prefer })

    try {
      const result = await BrowserManager.generateLocator({
        element: params.description,
        ref: params.description,
      })

      if (!result || !result.locator) {
        return {
          title: "No locators found",
          metadata: { description: params.description, locator: "" },
          output: `Could not find an element matching "${params.description}". Try a different description or verify the element exists.`,
        }
      }

      return {
        title: "Locator generated",
        metadata: {
          description: params.description,
          locator: result.locator,
        },
        output: `Generated locator for "${params.description}":\n\n${result.locator}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("generate locator failed", { error: message })
      throw new Error(`Failed to generate locator: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserGenerateLocatorTool)
