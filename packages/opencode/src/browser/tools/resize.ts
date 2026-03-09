import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Resize the browser viewport to specific dimensions.

Changes the browser window size. Useful for testing responsive layouts,
mobile viewports, or specific screen sizes.

Parameters:
- width (number, required): Viewport width in pixels
- height (number, required): Viewport height in pixels

Common viewport sizes:
- Mobile: 375x667 (iPhone), 414x896 (iPhone Plus)
- Tablet: 768x1024 (iPad), 1024x768 (iPad landscape)
- Desktop: 1280x720, 1920x1080 (Full HD)
`

export const BrowserResizeTool = Tool.define("browser_resize", {
  description: DESCRIPTION,
  parameters: z.object({
    width: z.number().min(100).max(4096).describe("Viewport width in pixels"),
    height: z.number().min(100).max(4096).describe("Viewport height in pixels"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["resize"],
      always: ["*"],
      metadata: { action: "resize", width: params.width, height: params.height },
    })

    log.info("resizing viewport", { width: params.width, height: params.height })

    try {
      await BrowserManager.resize(params.width, params.height)

      return {
        title: "Viewport resized",
        metadata: { width: params.width, height: params.height },
        output: `Viewport resized to ${params.width}x${params.height}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("resize failed", { error: message })
      throw new Error(`Resize failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserResizeTool)
