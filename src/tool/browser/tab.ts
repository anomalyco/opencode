import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserTabTool = Tool.define("browser_tab", {
  description: `Manage browser tabs. List open tabs, open new tabs, switch between tabs, or close tabs.

Use this tool to:
- See all open tabs and their URLs
- Open a URL in a new tab
- Switch to a different tab
- Close the current tab`,
  parameters: z.object({
    action: z
      .enum(["list", "new", "switch", "close"])
      .describe("Tab action: 'list' to see all tabs, 'new' to open a new tab, 'switch' to switch to a tab by index, 'close' to close current tab."),
    url: z.string().optional().describe("URL to open when action is 'new'."),
    index: z.number().optional().describe("Tab index to switch to when action is 'switch' (0-based)."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Tab: ${params.action}` })

    let result

    switch (params.action) {
      case "list":
        result = await BrowserClient.tabList(ctx.sessionID, { abort: ctx.abort })
        break
      case "new":
        result = await BrowserClient.tabNew(ctx.sessionID, params.url, { abort: ctx.abort })
        break
      case "switch":
        if (params.index === undefined) throw new Error("Tab index required for switch action")
        result = await BrowserClient.tabSwitch(ctx.sessionID, params.index, { abort: ctx.abort })
        break
      case "close":
        result = await BrowserClient.tabClose(ctx.sessionID, { abort: ctx.abort })
        break
    }

    if (result.exitCode !== 0) {
      throw new Error(`Tab ${params.action} failed: ${result.error || result.output}`)
    }

    // Get snapshot for non-list actions
    if (params.action !== "list") {
      const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
        interactive: true,
        abort: ctx.abort,
      })
      BrowserState.setSnapshot(ctx.sessionID, snapshot.output)
      return {
        title: `Tab ${params.action}`,
        metadata: { action: params.action },
        output: `Tab ${params.action} completed\n\n--- Page Snapshot ---\n${snapshot.output}`,
      }
    }

    return {
      title: "Tab list",
      metadata: { action: params.action },
      output: result.output,
    }
  },
})
