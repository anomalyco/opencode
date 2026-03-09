import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Close the browser or a specific page.

Parameters: None

Use this to clean up resources after browser tasks are complete.
`

export const BrowserCloseTool = Tool.define("browser_close", {
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["close"],
      always: ["*"],
      metadata: { action: "close" },
    })

    log.info("closing browser")

    try {
      if (!BrowserManager.isReady()) {
        return {
          title: "Browser not running",
          metadata: {},
          output: "Browser is not currently running",
        }
      }

      await BrowserManager.close()

      return {
        title: "Browser closed",
        metadata: {},
        output: "Browser closed successfully",
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("close failed", { error: message })
      throw new Error(`Close failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserCloseTool)
