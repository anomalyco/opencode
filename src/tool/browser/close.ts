import z from "zod"
import { Tool } from "../tool"
import { BrowserDaemon } from "../../browser/daemon"
import { BrowserState } from "../../browser/state"

export const BrowserCloseTool = Tool.define("browser_close", {
  description: `Close the browser and stop the browser daemon for the current session.

Use this tool when:
- The browser task is complete
- You need to restart the browser with different settings
- The user asks to close the browser`,
  parameters: z.object({}),
  async execute(_params, ctx) {
    ctx.metadata({ title: "Closing browser" })

    await BrowserDaemon.stop(ctx.sessionID)
    BrowserState.update(ctx.sessionID, { isRunning: false })

    return {
      title: "Browser closed",
      metadata: {},
      output: "Browser has been closed and the daemon stopped.",
    }
  },
})
