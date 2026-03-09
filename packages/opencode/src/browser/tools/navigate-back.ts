import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Navigate the browser back in history.

Goes back to the previous page, like clicking the browser's back button.
Optionally wait for navigation to complete.

Parameters:
- wait_until (string, optional): When to consider navigation complete (load, domcontentloaded, networkidle, commit)
`

export const BrowserNavigateBackTool = Tool.define("browser_navigate_back", {
  description: DESCRIPTION,
  parameters: z.object({
    wait_until: z
      .enum(["load", "domcontentloaded", "networkidle", "commit"])
      .default("load")
      .describe("When to consider navigation complete"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["navigate_back"],
      always: ["*"],
      metadata: { action: "navigate_back" },
    })

    log.info("navigating back", { waitUntil: params.wait_until })

    try {
      const result = await BrowserManager.goBack()

      if (!result.success) {
        throw new Error(result.error || "Failed to navigate back")
      }

      return {
        title: "Navigated back",
        metadata: { success: true },
        output: "Navigated back to the previous page",
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("navigate back failed", { error: message })
      throw new Error(`Navigate back failed: ${message}`)
    }
  },
})

export const BrowserNavigateForwardTool = Tool.define("browser_navigate_forward", {
  description: `Navigate the browser forward in history.

Goes forward to the next page, like clicking the browser's forward button.

Parameters:
- wait_until (string, optional): When to consider navigation complete (load, domcontentloaded, networkidle, commit)
`,
  parameters: z.object({
    wait_until: z
      .enum(["load", "domcontentloaded", "networkidle", "commit"])
      .default("load")
      .describe("When to consider navigation complete"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["navigate_forward"],
      always: ["*"],
      metadata: { action: "navigate_forward" },
    })

    log.info("navigating forward", { waitUntil: params.wait_until })

    try {
      const result = await BrowserManager.goForward()

      if (!result.success) {
        throw new Error(result.error || "Failed to navigate forward")
      }

      return {
        title: "Navigated forward",
        metadata: { success: true },
        output: "Navigated forward to the next page",
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("navigate forward failed", { error: message })
      throw new Error(`Navigate forward failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserNavigateBackTool)
Tool.attachExecute(BrowserNavigateForwardTool)
