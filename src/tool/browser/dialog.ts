import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserDialogTool = Tool.define("browser_dialog", {
  description: `Handle browser dialogs (alert, confirm, prompt popups). When a dialog appears, other browser commands are blocked until you handle it.

Actions:
- "status": Check if a dialog is currently open
- "accept": Click OK / Accept the dialog
- "accept_with_text": Accept a prompt() dialog with input text
- "dismiss": Click Cancel / Dismiss the dialog`,
  parameters: z.object({
    action: z.enum(["status", "accept", "accept_with_text", "dismiss"]).describe("Dialog action to take."),
    text: z.string().optional().describe("Text to enter when accepting a prompt() dialog. Only used with 'accept_with_text'."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Dialog: ${params.action}` })

    let args: string[]
    switch (params.action) {
      case "status":
        args = ["dialog", "status"]
        break
      case "accept":
        args = ["dialog", "accept"]
        break
      case "accept_with_text":
        if (!params.text) throw new Error("Text is required for accept_with_text action")
        args = ["dialog", "accept", params.text]
        break
      case "dismiss":
        args = ["dialog", "dismiss"]
        break
    }

    const result = await BrowserClient.exec(ctx.sessionID, args, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Dialog ${params.action} failed: ${result.error || result.output}`)
    }

    // Get updated snapshot after handling dialog
    if (params.action !== "status") {
      const snapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, abort: ctx.abort })
      BrowserState.setSnapshot(ctx.sessionID, snapshot.output)
      return {
        title: `Dialog ${params.action}`,
        metadata: { action: params.action },
        output: `Dialog ${params.action} completed\n\n--- Page Snapshot ---\n${snapshot.output}`,
      }
    }

    return {
      title: "Dialog status",
      metadata: { action: params.action },
      output: result.output,
    }
  },
})
