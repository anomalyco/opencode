import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Capture accessibility snapshot of the current page. It provides a structured view of all interactive elements, not the image.

Parameters:
- filename (string, optional): Save snapshot to file instead of returning in response
`

export const BrowserSnapshotTool = Tool.define("browser_snapshot", {
  description: DESCRIPTION,
  parameters: z.object({
    filename: z.string().optional().describe("Save snapshot to markdown file instead of returning it"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["snapshot"],
      always: ["*"],
      metadata: { action: "snapshot" },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("taking accessibility snapshot")

    try {
      const result = await BrowserManager.snapshot()
      const info = await BrowserManager.getPageInfo()

      let output = `Page: ${info.title}\nURL: ${info.url}\n\nAccessibility Tree:\n${result.snapshot}`

      // Count elements
      const elementCount = Object.keys(result.elementMap).length

      return {
        title: `Snapshot: ${info.title}`,
        metadata: {
          url: info.url,
          pageTitle: info.title,
          elementCount,
        },
        output,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("snapshot failed", { error: message })
      throw new Error(`Snapshot failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserSnapshotTool)
