import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Check or uncheck a checkbox or radio button.

Parameters:
- element (string): Human-readable element description
- ref (string): Exact element reference from the page snapshot
- checked (boolean): Whether to check (true) or uncheck (false) the element
`

export const BrowserCheckTool = Tool.define("browser_check", {
  description: DESCRIPTION,
  parameters: z.object({
    element: z.string().describe("Human-readable element description"),
    ref: z.string().describe("Exact element reference from the page snapshot"),
    checked: z.boolean().default(true).describe("Whether to check or uncheck"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.ref],
      always: ["*"],
      metadata: { action: "check", element: params.element, checked: params.checked },
    })

    log.info("checking element", { element: params.element, checked: params.checked })

    try {
      if (!BrowserManager.isReady()) {
        throw new Error("Browser is not initialized")
      }

      await BrowserManager.check(params.ref, params.checked)

      return {
        title: `Element ${params.checked ? "checked" : "unchecked"}`,
        metadata: {
          element: params.element,
          ref: params.ref,
          checked: params.checked,
        },
        output: `Successfully ${params.checked ? "checked" : "unchecked"} "${params.element}"`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("check failed", { error: message })
      throw new Error(`Check failed: ${message}`)
    }
  },
})
