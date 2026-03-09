import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Select an option in a dropdown.

Parameters:
- element (string): Human-readable element description
- ref (string): Exact target element reference from the page snapshot
- values (array): Array of values to select. Can be single or multiple values.
`

export const BrowserSelectOptionTool = Tool.define("browser_select_option", {
  description: DESCRIPTION,
  parameters: z.object({
    element: z.string().describe("Human-readable element description"),
    ref: z.string().describe("Exact target element reference from the page snapshot"),
    values: z.array(z.string()).describe("Array of values to select in the dropdown"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.ref],
      always: ["*"],
      metadata: { action: "select_option", element: params.element, values: params.values },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("selecting option", { element: params.element, values: params.values })

    try {
      const result = await BrowserManager.select({
        selector: params.ref,
        values: params.values,
      })

      if (!result.success) {
        throw new Error(result.error || "Select option failed")
      }

      return {
        title: `Selected: ${params.values.join(", ")}`,
        metadata: {
          element: params.element,
          ref: params.ref,
          values: params.values,
        },
        output: `Successfully selected "${params.values.join(", ")}" in "${params.element}"`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("select option failed", { error: message })
      throw new Error(`Select option failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserSelectOptionTool)
