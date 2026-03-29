import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserDragTool = Tool.define("browser_drag", {
  description: `Drag an element and drop it on another element. Use @ref references from the snapshot for both source and target.`,
  parameters: z.object({
    source: z.string().describe("Element reference to drag from (e.g., '@e3')."),
    target: z.string().describe("Element reference to drop onto (e.g., '@e7')."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Dragging ${params.source} → ${params.target}` })

    const result = await BrowserClient.exec(
      ctx.sessionID,
      ["drag", params.source, params.target],
      { abort: ctx.abort },
    )

    if (result.exitCode !== 0) {
      throw new Error(`Drag failed: ${result.error || result.output}`)
    }

    const snapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, abort: ctx.abort })
    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Dragged ${params.source} → ${params.target}`,
      metadata: { source: params.source, target: params.target },
      output: `Dragged ${params.source} to ${params.target}\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
