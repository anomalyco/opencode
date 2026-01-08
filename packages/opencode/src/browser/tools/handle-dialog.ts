import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Handle browser dialogs (alert, confirm, prompt, beforeunload).

Configure how to respond to the next dialog that appears. 
Can accept, dismiss, or provide text input for prompts.

Parameters:
- action (string, required): How to handle the dialog (accept, dismiss)
- prompt_text (string, optional): Text to enter if the dialog is a prompt
`

export const BrowserHandleDialogTool = Tool.define("browser_handle_dialog", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["accept", "dismiss"]).describe("How to handle the dialog"),
    prompt_text: z.string().optional().describe("Text to enter if the dialog is a prompt"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["handle_dialog"],
      always: ["*"],
      metadata: { action: "handle_dialog", dialogAction: params.action },
    })

    log.info("handling dialog", { action: params.action, promptText: params.prompt_text })

    try {
      await BrowserManager.handleDialog(params.action === "accept", params.prompt_text)

      return {
        title: "Dialog handler configured",
        metadata: { action: params.action, hasPromptText: !!params.prompt_text },
        output: `Dialog handler set to ${params.action}${params.prompt_text ? ` with text "${params.prompt_text}"` : ""}. The next dialog will be handled automatically.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("handle dialog failed", { error: message })
      throw new Error(`Failed to configure dialog handler: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserHandleDialogTool)
