import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserUploadTool = Tool.define("browser_upload", {
  description: `Upload a file to a file input element on the page. Use the element @ref from the snapshot to target the file input.

The file must exist in the agent's data directory.`,
  parameters: z.object({
    ref: z.string().describe("Element reference of the file input (e.g., '@e4')."),
    filePath: z.string().describe("Path to the file to upload (must be in the agent's data directory)."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_upload",
      patterns: [params.filePath],
      always: [],
      metadata: { ref: params.ref, filePath: params.filePath },
    })

    ctx.metadata({ title: `Uploading to ${params.ref}` })

    const result = await BrowserClient.exec(
      ctx.sessionID,
      ["upload", params.ref, params.filePath],
      { abort: ctx.abort },
    )

    if (result.exitCode !== 0) {
      throw new Error(`Upload failed: ${result.error || result.output}`)
    }

    const snapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, abort: ctx.abort })
    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Uploaded to ${params.ref}`,
      metadata: { ref: params.ref },
      output: `File uploaded to ${params.ref}\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
