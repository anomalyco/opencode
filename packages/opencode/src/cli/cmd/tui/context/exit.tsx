import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import * as fs from "fs"

type Renderer = ReturnType<typeof useRenderer>

// Module-level state to track renderer for SIGINT handler
const state: { renderer: Renderer | null } = { renderer: null }

// ANSI escape sequences to disable all mouse tracking modes
// This covers: basic tracking, button events, any-event, SGR extended, URXVT modes
const DISABLE_MOUSE_SEQUENCES = [
  "\x1b[?1000l", // Disable X11 mouse tracking (button press/release)
  "\x1b[?1002l", // Disable button-event tracking (press/release/motion with button)
  "\x1b[?1003l", // Disable any-event tracking (all motion)
  "\x1b[?1006l", // Disable SGR extended mouse mode
  "\x1b[?1015l", // Disable URXVT extended mouse mode
  "\x1b[?25h",   // Show cursor (ensure cursor is visible after exit)
].join("")

/**
 * Synchronously write terminal cleanup sequences directly to stdout.
 * Using fs.writeSync ensures the sequences are sent immediately before process exit,
 * bypassing any buffering that could cause sequences to be lost.
 */
function cleanupTerminal(): void {
  try {
    fs.writeSync(1, DISABLE_MOUSE_SEQUENCES)
  } catch {
    // Ignore errors - stdout may already be closed
  }
}

/**
 * Cleanup and destroy the renderer.
 * Called from SIGINT handler to ensure proper terminal restoration on Ctrl+C.
 */
export function destroyRenderer(): void {
  cleanupTerminal()

  if (!state.renderer) return

  try {
    state.renderer.setTerminalTitle("")
    state.renderer.destroy()
  } catch {
    // Ignore errors during cleanup
  }
  state.renderer = null
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    state.renderer = renderer

    return async (reason?: unknown) => {
      // Send cleanup sequences BEFORE destroying renderer to ensure they're flushed
      cleanupTerminal()

      // Reset window title and destroy renderer
      renderer.setTerminalTitle("")
      renderer.destroy()

      await input.onExit?.()

      if (reason) {
        const formatted = FormatError(reason) ?? FormatUnknownError(reason)
        if (formatted) process.stderr.write(formatted + "\n")
      }

      process.exit(0)
    }
  },
})
