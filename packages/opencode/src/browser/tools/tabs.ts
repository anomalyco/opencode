import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Manage browser tabs: list, create, close, or select.

Parameters:
- action (string): Operation to perform - 'list', 'create', 'close', 'select'
- index (number, optional): Tab index for close/select operations. If omitted for close, current tab is closed.
`

export const BrowserTabsTool = Tool.define("browser_tabs", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["list", "create", "close", "select"]).describe("Operation to perform"),
    index: z.number().optional().describe("Tab index for close/select operations"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["tabs"],
      always: ["*"],
      metadata: { action: "tabs", tabAction: params.action },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("managing tabs", { action: params.action, index: params.index })

    try {
      const result = await BrowserManager.tabs(params.action, params.index)

      if (!result.success) {
        throw new Error(result.error || "Tab operation failed")
      }

      let output: string
      switch (params.action) {
        case "list":
          output = result.tabs?.length
            ? `Tabs:\n${result.tabs.map((t) => `${t.active ? "→ " : "  "}[${t.index}] ${t.title || t.url}`).join("\n")}`
            : "No tabs open"
          break
        case "create":
          output = "New tab created"
          break
        case "close":
          output = params.index !== undefined ? `Closed tab ${params.index}` : "Closed current tab"
          break
        case "select":
          output = `Switched to tab ${params.index}`
          break
        default:
          output = "Tab operation completed"
      }

      return {
        title: `Tabs: ${params.action}`,
        metadata: {
          action: params.action,
          index: params.index,
          tabCount: result.tabs?.length,
        },
        output,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("tabs operation failed", { error: message })
      throw new Error(`Tabs operation failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserTabsTool)
