import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserHoverTool = Tool.define("browser_hover", {
  description: `Hover over an element on the page. Use this to trigger hover menus, tooltips, dropdowns, or any hover-activated UI. Returns updated snapshot after hovering.`,
  parameters: z.object({
    ref: z.string().describe("Element reference from snapshot (e.g., '@e3')."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Hovering ${params.ref}` })

    const result = await BrowserClient.hover(ctx.sessionID, params.ref, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Hover failed: ${result.error || result.output}`)
    }

    const snapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, abort: ctx.abort })
    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Hovered ${params.ref}`,
      metadata: { ref: params.ref },
      output: `Hovered over ${params.ref}\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
