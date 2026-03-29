import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserSnapshotTool = Tool.define("browser_snapshot", {
  description: `Get the accessibility snapshot of the current browser page. Returns a structured tree of all elements with element references (@e1, @e2, etc.) that can be used with other browser tools (click, type, etc.).

The snapshot shows:
- Interactive elements (buttons, links, inputs) with their @ref identifiers
- Text content of the page
- Element hierarchy and relationships

Use this tool to:
- See what's currently on the page
- Find element references for interaction
- Check if a page has loaded correctly
- Understand the page structure before taking actions`,
  parameters: z.object({
    interactive: z.boolean().default(true).describe("If true (default), show only interactive elements. Set to false for full page tree."),
    compact: z.boolean().optional().describe("If true, show a more compact output."),
    selector: z.string().optional().describe("CSS selector to scope the snapshot to a specific part of the page."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: "Getting page snapshot" })

    const result = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: params.interactive,
      compact: params.compact,
      selector: params.selector,
      abort: ctx.abort,
    })

    if (result.exitCode !== 0) {
      throw new Error(`Snapshot failed: ${result.error || result.output}`)
    }

    BrowserState.setSnapshot(ctx.sessionID, result.output)

    return {
      title: "Page snapshot",
      metadata: { interactive: params.interactive },
      output: `--- Page Snapshot ---\n${result.output}`,
    }
  },
})
