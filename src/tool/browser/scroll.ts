import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserScrollTool = Tool.define("browser_scroll", {
  description: `Scroll the browser page in a specified direction. After scrolling, returns an updated accessibility snapshot.

Use this tool to:
- Scroll down to see more content below the fold
- Scroll up to return to the top of the page
- Scroll within a specific container element`,
  parameters: z.object({
    direction: z.enum(["up", "down", "left", "right"]).describe("Direction to scroll."),
    amount: z.number().optional().describe("Number of pixels to scroll. Defaults to one viewport height."),
    selector: z.string().optional().describe("CSS selector to scope scrolling to a specific container."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Scrolling ${params.direction}` })

    const result = await BrowserClient.scroll(
      ctx.sessionID,
      params.direction,
      params.amount,
      { selector: params.selector, abort: ctx.abort },
    )

    if (result.exitCode !== 0) {
      throw new Error(`Scroll failed: ${result.error || result.output}`)
    }

    // Get updated snapshot
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })

    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Scrolled ${params.direction}`,
      metadata: { direction: params.direction, amount: params.amount },
      output: `Scrolled ${params.direction}${params.amount ? ` by ${params.amount}px` : ""}\n\n--- Updated Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
