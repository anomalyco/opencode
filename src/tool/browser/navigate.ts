import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserNavigateTool = Tool.define("browser_navigate", {
  description: `Navigate the browser to a new URL, or go back/forward in history. Returns the page's accessibility snapshot with element references.

Use this tool to:
- Navigate to a different URL in the current browser session
- Go back or forward in browser history
- Reload the current page`,
  parameters: z.object({
    url: z.string().optional().describe("The URL to navigate to. Omit if using action."),
    action: z
      .enum(["back", "forward", "reload"])
      .optional()
      .describe("Navigation action instead of URL. Use 'back', 'forward', or 'reload'."),
  }),
  async execute(params, ctx) {
    if (!params.url && !params.action) {
      throw new Error("Either 'url' or 'action' must be provided")
    }

    if (params.url && !params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    const target = params.url || params.action!

    await ctx.ask({
      permission: "browser_navigate",
      patterns: [target],
      always: ["*"],
      metadata: { url: params.url, action: params.action },
    })

    ctx.metadata({ title: `Navigating to ${target}` })

    let result
    if (params.action === "back") {
      result = await BrowserClient.back(ctx.sessionID, { abort: ctx.abort })
    } else if (params.action === "forward") {
      result = await BrowserClient.forward(ctx.sessionID, { abort: ctx.abort })
    } else if (params.action === "reload") {
      result = await BrowserClient.reload(ctx.sessionID, { abort: ctx.abort })
    } else {
      result = await BrowserClient.navigate(ctx.sessionID, params.url!, {
        timeout: 30_000,
        abort: ctx.abort,
      })
    }

    if (result.exitCode !== 0) {
      throw new Error(`Navigation failed: ${result.error || result.output}`)
    }

    if (params.url) {
      BrowserState.setUrl(ctx.sessionID, params.url)
    }

    // Get snapshot after navigation
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })

    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Navigated to ${target}`,
      metadata: { url: params.url, action: params.action },
      output: `Navigated to ${target}\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
