import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Get bounding box of an element by selector.

Parameters:
- selector (string): CSS selector or ref ID of the element

Returns the element's position and size: x, y, width, height in pixels.
`

export const BrowserGetElementBoundsTool = Tool.define("browser_get_element_bounds", {
  description: DESCRIPTION,
  parameters: z.object({
    selector: z.string().describe("CSS selector or ref ID of the element"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.selector],
      always: ["*"],
      metadata: { action: "getElementBounds", selector: params.selector },
    })

    log.info("getting element bounds", { selector: params.selector })

    try {
      if (!BrowserManager.isReady()) {
        throw new Error("Browser is not initialized")
      }

      const bounds = await BrowserManager.getElementBounds(params.selector)

      if (!bounds) {
        return {
          title: "Element not found",
          metadata: { selector: params.selector, found: false },
          output: `Element not found or not visible: ${params.selector}`,
        }
      }

      return {
        title: "Element Bounds",
        metadata: {
          selector: params.selector,
          found: true,
          ...bounds,
        },
        output: `Element bounds:\nx: ${bounds.x}px\ny: ${bounds.y}px\nwidth: ${bounds.width}px\nheight: ${bounds.height}px`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("get element bounds failed", { error: message })
      throw new Error(`Failed to get element bounds: ${message}`)
    }
  },
})
