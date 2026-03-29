import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserTypeTool = Tool.define("browser_type", {
  description: `Type text into an input field or textarea in the browser. Use element references (@e1, @e2, etc.) from the accessibility snapshot to identify which element to type into.

You can choose to either:
- "fill" mode (default): Clears the field first, then types the new text
- "type" mode: Appends text to whatever is already in the field

After typing, optionally press Enter to submit.

Use this tool to:
- Fill in form fields (search boxes, login forms, text areas)
- Type search queries
- Enter data into web applications`,
  parameters: z.object({
    ref: z.string().describe("Element reference from snapshot (e.g., '@e2', '@e7'). Must be an input or textarea element."),
    text: z.string().describe("The text to type into the element."),
    submit: z.boolean().optional().describe("If true, press Enter after typing to submit the form."),
    clearFirst: z.boolean().default(true).describe("If true (default), clears the field before typing. Set to false to append text."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_type",
      patterns: [params.ref],
      always: ["*"],
      metadata: { ref: params.ref, text: params.text },
    })

    ctx.metadata({ title: `Typing into ${params.ref}` })

    // Use fill (clear+type) or type (append) based on clearFirst
    let result
    if (params.clearFirst !== false) {
      result = await BrowserClient.fill(ctx.sessionID, params.ref, params.text, {
        abort: ctx.abort,
      })
    } else {
      result = await BrowserClient.type(ctx.sessionID, params.ref, params.text, {
        abort: ctx.abort,
      })
    }

    if (result.exitCode !== 0) {
      throw new Error(`Type failed: ${result.error || result.output}`)
    }

    // Optionally press Enter to submit
    if (params.submit) {
      await BrowserClient.press(ctx.sessionID, "Enter", { abort: ctx.abort })
    }

    // Get updated snapshot
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })

    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Typed into ${params.ref}`,
      metadata: { ref: params.ref, textLength: params.text.length },
      output: `Typed "${params.text.slice(0, 50)}${params.text.length > 50 ? "..." : ""}" into ${params.ref}${params.submit ? " and pressed Enter" : ""}\n\n--- Updated Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
