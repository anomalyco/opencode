import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserClickTool = Tool.define("browser_click", {
  description: `Click on an element in the browser page. Use element references (@e1, @e2, etc.) from the accessibility snapshot to identify which element to click.

After clicking, returns an updated accessibility snapshot showing the new page state.

Use this tool to:
- Click buttons, links, and interactive elements
- Submit forms
- Open menus and dropdowns
- Interact with any clickable element on the page`,
  parameters: z.object({
    ref: z.string().describe("Element reference from snapshot (e.g., '@e1', '@e5'). Use references from the most recent snapshot."),
    newTab: z.boolean().optional().describe("If true, opens the clicked link in a new tab."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_click",
      patterns: [params.ref],
      always: ["*"],
      metadata: { ref: params.ref },
    })

    ctx.metadata({ title: `Clicking ${params.ref}` })

    const result = await BrowserClient.click(ctx.sessionID, params.ref, {
      newTab: params.newTab,
      abort: ctx.abort,
    })

    if (result.exitCode !== 0) {
      throw new Error(`Click failed: ${result.error || result.output}`)
    }

    // Get updated snapshot
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })

    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Clicked ${params.ref}`,
      metadata: { ref: params.ref },
      output: `Clicked element ${params.ref}\n\n--- Updated Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
