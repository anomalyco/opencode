import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Close the current page while keeping the browser running.

This closes just the current page/tab, not the entire browser. Use browser_close to close the browser completely.
`

export const BrowserClosePageTool = Tool.define("browser_close_page", {
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["close_page"],
      always: ["*"],
      metadata: { action: "closePage" },
    })

    log.info("closing current page")

    try {
      if (!BrowserManager.isReady()) {
        return {
          title: "Browser not running",
          metadata: {},
          output: "Browser is not currently running",
        }
      }

      await BrowserManager.closePage()

      return {
        title: "Page closed",
        metadata: {},
        output: "Current page closed successfully",
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("close page failed", { error: message })
      throw new Error(`Close page failed: ${message}`)
    }
  },
})
