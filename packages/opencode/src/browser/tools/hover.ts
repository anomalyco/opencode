import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Hover over an element on the page. This moves the cursor to the element and triggers hover effects.

Parameters:
- element (string): Human-readable element description
- ref (string): Exact target element reference from the page snapshot

The cursor will animate to the element position visibly.
`

export const BrowserHoverTool = Tool.define("browser_hover", {
  description: DESCRIPTION,
  parameters: z.object({
    element: z.string().describe("Human-readable element description"),
    ref: z.string().describe("Exact target element reference from the page snapshot"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.ref],
      always: ["*"],
      metadata: { action: "hover", element: params.element },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("hovering", { element: params.element, ref: params.ref })

    try {
      const result = await BrowserManager.hover({
        selector: params.ref,
      })

      if (!result.success) {
        throw new Error(result.error || "Hover failed")
      }

      return {
        title: `Hovered: ${params.element}`,
        metadata: {
          element: params.element,
          ref: params.ref,
        },
        output: `Successfully hovered over "${params.element}"`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("hover failed", { error: message })
      throw new Error(`Hover failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserHoverTool)
