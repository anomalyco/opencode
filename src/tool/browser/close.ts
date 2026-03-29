import z from "zod"
import { Tool } from "../tool"
import { BrowserDaemon } from "../../browser/daemon"
import { BrowserState } from "../../browser/state"

export const BrowserCloseTool = Tool.define("browser_close", {
  description: `Close the browser and stop the browser daemon. This is an internal tool used only when the session ends. Do NOT call this during normal task execution — the browser should stay open for the entire session. The browser is automatically closed when the session ends.`,
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
