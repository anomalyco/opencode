import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserPressTool = Tool.define("browser_press", {
  description: `Press a keyboard key or key combination. Use this for:
- Pressing Enter, Escape, Tab, Backspace, Delete
- Key combinations like Ctrl+A, Ctrl+C, Ctrl+V
- Arrow keys for navigation
- Function keys (F1-F12)
- Any other keyboard shortcut

Common keys: Enter, Escape, Tab, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space, F1-F12
Modifiers: Control+, Shift+, Alt+, Meta+ (e.g., "Control+a", "Shift+Tab")`,
  parameters: z.object({
    key: z.string().describe("Key to press (e.g., 'Enter', 'Escape', 'Control+a', 'Tab')."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: `Pressing ${params.key}` })

    const result = await BrowserClient.press(ctx.sessionID, params.key, { abort: ctx.abort })

    if (result.exitCode !== 0) {
      throw new Error(`Press failed: ${result.error || result.output}`)
    }

    const snapshot = await BrowserClient.snapshot(ctx.sessionID, { interactive: true, abort: ctx.abort })
    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    return {
      title: `Pressed ${params.key}`,
      metadata: { key: params.key },
      output: `Pressed "${params.key}"\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
