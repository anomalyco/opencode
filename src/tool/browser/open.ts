import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserDaemon } from "../../browser/daemon"
import { BrowserState } from "../../browser/state"

export const BrowserOpenTool = Tool.define("browser_open", {
  description: `Open a URL in the browser. This starts the browser if not already running and navigates to the specified URL. Returns the page's accessibility snapshot with element references (@e1, @e2, etc.) that can be used with other browser tools.

Use this tool to:
- Start a new browser session and navigate to a URL
- Open a website for automation or data extraction
- Begin a browser-based task

The browser opens in headed mode so the user can see what's happening.`,
  parameters: z.object({
    url: z.string().describe("The URL to open (must start with http:// or https://)"),
  }),
  async execute(params, ctx) {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    await ctx.ask({
      permission: "browser_open",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url },
    })

    // Ensure daemon is running
    if (!BrowserDaemon.isRunning(ctx.sessionID)) {
      await BrowserDaemon.start(ctx.sessionID, { headed: true })
      BrowserState.create(ctx.sessionID, true)
    }

    ctx.metadata({ title: `Opening ${params.url}` })

    const result = await BrowserClient.open(ctx.sessionID, params.url, {
      timeout: 30_000,
      abort: ctx.abort,
    })

    if (result.exitCode !== 0) {
      throw new Error(`Failed to open URL: ${result.error || result.output}`)
    }

    BrowserState.setUrl(ctx.sessionID, params.url)

    // Get snapshot after navigation
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })

    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Opened ${params.url}`,
      metadata: { url: params.url },
      output: `Navigated to ${params.url}\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
