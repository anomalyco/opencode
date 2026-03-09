import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Get element at specific coordinates on the page.

Parameters:
- x (number): X coordinate in pixels
- y (number): Y coordinate in pixels

Returns information about the element at those coordinates including tag name, text, and bounds.
`

export const BrowserGetElementAtTool = Tool.define("browser_get_element_at", {
  description: DESCRIPTION,
  parameters: z.object({
    x: z.number().describe("X coordinate in pixels"),
    y: z.number().describe("Y coordinate in pixels"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["get_element_at"],
      always: ["*"],
      metadata: { action: "getElementAt", x: params.x, y: params.y },
    })

    log.info("getting element at coordinates", { x: params.x, y: params.y })

    try {
      if (!BrowserManager.isReady()) {
        throw new Error("Browser is not initialized")
      }

      const element = await BrowserManager.getElementAt(params.x, params.y)

      if (!element) {
        return {
          title: "No element found",
          metadata: {
            x: params.x,
            y: params.y,
            found: false,
            tagName: null,
            text: null,
            id: null,
            className: null,
          },
          output: `No interactive element found at coordinates (${params.x}, ${params.y})`,
        }
      }

      return {
        title: "Element Found",
        metadata: {
          x: params.x,
          y: params.y,
          found: true,
          tagName: element.tagName || null,
          text: element.text || null,
          id: element.id || null,
          className: element.className || null,
        },
        output: `Found <${element.tagName}> at (${params.x}, ${params.y})\nText: "${element.text}"\nBounds: x=${element.bounds.x}, y=${element.bounds.y}, w=${element.bounds.width}, h=${element.bounds.height}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("get element at failed", { error: message })
      throw new Error(`Failed to get element: ${message}`)
    }
  },
})
