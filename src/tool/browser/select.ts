import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserSelectTool = Tool.define("browser_select", {
  description: `Select an option from a dropdown/select element. Use the element @ref from the snapshot.`,
  parameters: z.object({
    ref: z.string().describe("Element reference of the <select> element (e.g., '@e6')."),
    value: z.string().describe("The option value or visible text to select."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Selecting "${params.value}" in ${params.ref}` })

    const result = await BrowserClient.select(ctx.sessionID, params.ref, params.value, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Select failed: ${result.error || result.output}`)
    }

    const snapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, abort: ctx.abort })
    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Selected "${params.value}"`,
      metadata: { ref: params.ref, value: params.value },
      output: `Selected "${params.value}" in ${params.ref}\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
