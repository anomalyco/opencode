import { useRenderer } from "@opentui/solid"
import { writeSync } from "fs"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let message: string | undefined
    const store = {
      set: (value?: string) => {
        const prev = message
        message = value
        return () => {
          message = prev
        }
      },
      clear: () => {
        message = undefined
      },
      get: () => message,
    }
    const exit: Exit = Object.assign(
      async (reason?: unknown) => {
        // Reset window title before destroying renderer
        renderer.setTerminalTitle("")
        renderer.destroy()
        await input.onExit?.()
        if (reason) {
          const formatted = FormatError(reason) ?? FormatUnknownError(reason)
          if (formatted) {
            process.stderr.write(formatted + "\n")
          }
        }
        const text = store.get()
        // Give the zig render thread time to finish its final frame
        // before writing terminal restore sequences
        await new Promise((r) => setTimeout(r, 50))
        // Restore terminal: exit alternate screen, clear screen, show cursor, reset attrs
        writeSync(1, "\x1b[?1049l\x1b[2J\x1b[H\x1b[?25h\x1b[0m")
        if (text) process.stdout.write(text + "\n")
        process.exit(0)
      },
      {
        message: store,
      },
    )
    return exit
  },
})
