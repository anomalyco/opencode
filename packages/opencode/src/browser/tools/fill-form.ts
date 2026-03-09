import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Fill multiple form fields at once. More efficient than multiple browser_type calls.

Parameters:
- fields (array): Array of fields to fill, each with:
  - selector (string): CSS selector or ref of the field
  - value (string): Value to fill in
`

export const BrowserFillFormTool = Tool.define("browser_fill_form", {
  description: DESCRIPTION,
  parameters: z.object({
    fields: z
      .array(
        z.object({
          selector: z.string().describe("CSS selector or ref of the field"),
          value: z.string().describe("Value to fill in"),
        }),
      )
      .describe("Fields to fill in"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: params.fields.map((f) => f.selector),
      always: ["*"],
      metadata: { action: "fill_form", fieldCount: params.fields.length },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("filling form", { fieldCount: params.fields.length })

    try {
      const result = await BrowserManager.fillForm(params.fields)

      if (!result.success) {
        throw new Error(result.error || "Fill form failed")
      }

      return {
        title: `Filled ${result.filled} fields`,
        metadata: {
          fieldCount: params.fields.length,
          filled: result.filled,
        },
        output: `Successfully filled ${result.filled} of ${params.fields.length} form fields`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("fill form failed", { error: message })
      throw new Error(`Fill form failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserFillFormTool)
