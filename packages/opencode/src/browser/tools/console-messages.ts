import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Get console messages from the browser page.

Returns console.log, console.error, console.warn, etc. messages captured during page execution.
Useful for debugging and verifying JavaScript behavior.

Parameters:
- type (string, optional): Filter by message type (log, error, warn, info, debug)
- limit (number, optional): Maximum number of messages to return (default: 50)
`

export const BrowserConsoleMessagesTool = Tool.define("browser_console_messages", {
  description: DESCRIPTION,
  parameters: z.object({
    type: z.enum(["log", "error", "warn", "info", "debug"]).optional().describe("Filter by message type"),
    limit: z.number().default(50).describe("Maximum number of messages to return"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["console_messages"],
      always: ["*"],
      metadata: { action: "console_messages", type: params.type },
    })

    log.info("getting console messages", { type: params.type, limit: params.limit })

    try {
      const messages = await BrowserManager.getConsoleMessages()

      let filtered = messages
      if (params.type) {
        filtered = messages.filter((m: any) => m.type === params.type)
      }

      const limited = filtered.slice(0, params.limit)

      if (limited.length === 0) {
        return {
          title: "Console messages",
          metadata: { count: 0, type: params.type, total: 0 },
          output: params.type ? `No console messages of type "${params.type}" found` : "No console messages captured",
        }
      }

      const formatted = limited.map((m: any, i: number) => `[${i + 1}] [${m.type.toUpperCase()}] ${m.text}`).join("\n")

      return {
        title: "Console messages",
        metadata: { count: limited.length, type: params.type, total: messages.length },
        output: formatted,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("get console messages failed", { error: message })
      throw new Error(`Failed to get console messages: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserConsoleMessagesTool)
