import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import * as fs from "fs"

type Renderer = ReturnType<typeof useRenderer>

const state: { renderer: Renderer | null } = { renderer: null }

const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?25h"

function cleanupTerminal() {
  fs.writeSync(1, DISABLE_MOUSE)
}

export function destroyRenderer() {
  if (!state.renderer) {
    cleanupTerminal()
    return
  }
  state.renderer.setTerminalTitle("")
  state.renderer.destroy()
  state.renderer = null
  cleanupTerminal()
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    state.renderer = renderer

    return async (reason?: unknown) => {
      cleanupTerminal()
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
