import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"

export const BrowserConsoleTool = Tool.define("browser_console", {
  description: `View browser console output and page errors. Useful for debugging page issues, checking for JavaScript errors, or reading console.log output.

Actions:
- "console": View console messages (log, warn, error, info)
- "errors": View page errors only`,
  parameters: z.object({
    action: z.enum(["console", "errors"]).default("console").describe("What to view."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Browser ${params.action}` })

    const result = await BrowserClient.exec(ctx.sessionID, [params.action], { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`${params.action} failed: ${result.error || result.output}`)
    }

    return {
      title: `Browser ${params.action}`,
      metadata: { action: params.action },
      output: result.output || `No ${params.action} messages.`,
    }
  },
})
