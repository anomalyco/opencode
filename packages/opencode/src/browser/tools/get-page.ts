import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Get current page information.

Returns page metadata including URL, title, scroll position, and viewport dimensions.
`

export const BrowserGetPageTool = Tool.define("browser_get_page", {
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["get"],
      always: ["*"],
      metadata: { action: "getPage" },
    })

    log.info("getting page info")

    try {
      if (!BrowserManager.isReady()) {
        throw new Error("Browser is not initialized")
      }

      const pageInfo = await BrowserManager.getPageInfo()

      return {
        title: "Page Information",
        metadata: pageInfo,
        output: `Current page: ${pageInfo.title || "No title"}\nURL: ${pageInfo.url}\nViewport: ${pageInfo.viewport.width}x${pageInfo.viewport.height}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("get page info failed", { error: message })
      throw new Error(`Failed to get page info: ${message}`)
    }
  },
})
