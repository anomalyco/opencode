import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserFrameTool = Tool.define("browser_frame", {
  description: `Switch iframe context. Use this when you need to interact with content inside an iframe. Elements inside iframes may not appear in the main page snapshot — switch to the iframe first, then take a snapshot.

- Switch to an iframe by its @ref or CSS selector
- Use "main" to return to the main page context
- After switching, take a new snapshot to see iframe contents`,
  parameters: z.object({
    target: z.string().describe("The iframe @ref (e.g., '@e5'), CSS selector, or 'main' to return to the top-level page."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Switching to frame: ${params.target}` })

    const result = await BrowserClient.exec(ctx.sessionID, ["frame", params.target], { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Frame switch failed: ${result.error || result.output}`)
    }

    const snapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, abort: ctx.abort })
    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Switched to frame: ${params.target}`,
      metadata: { target: params.target },
      output: `Switched to frame "${params.target}"\n\n--- Frame Snapshot ---\n${snapshot.output}`,
    }
  },
})
