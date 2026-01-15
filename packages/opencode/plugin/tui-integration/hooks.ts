/**
 * TUI hooks for shell mode integration.
 * Provides keyboard handling and routing logic.
 */

import { getModeController, ExecutionMode, shouldRouteToShell } from "@shell-mode"
import type { KeyEvent } from "@opentui/core"

export type ModeToggleContext = {
  setMode: (mode: ExecutionMode) => void
}

/**
 * Handle Ctrl+Space to toggle execution mode.
 * Returns true if the event was handled, false otherwise.
 */
export function handleModeToggleKey(e: KeyEvent, ctx: ModeToggleContext): boolean {
  // Ctrl+Space to toggle mode
  // Note: Ctrl+Space can appear as sequence "\x00" (null) in some terminals
  if (
    e.ctrl &&
    !e.meta &&
    !e.shift &&
    (e.name === " " || e.name === "space" || e.sequence === "\x00")
  ) {
    const newMode = getModeController().toggleMode()
    ctx.setMode(newMode)
    return true
  }
  return false
}

/**
 * Determine routing for input based on current execution mode.
 * Returns "shell" or "agent".
 */
export async function determineRouting(input: string): Promise<"shell" | "agent"> {
  const mode = getModeController().getMode()

  if (mode === ExecutionMode.Shell) {
    return "shell"
  }

  if (mode === ExecutionMode.Agent) {
    return "agent"
  }

  // Auto mode: use command -v check
  const isCommand = await shouldRouteToShell(input)
  return isCommand ? "shell" : "agent"
}
