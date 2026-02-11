import { useRenderer } from "@opentui/solid"
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
    const exit = Object.assign(
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
        if (text) process.stdout.write(text + "\n")
        // Ensure the process exits with a non-zero code for errors
        const exitCode = reason instanceof Error ? 1 : 0
        process.exit(exitCode)
      },
      {
        message: store,
      },
    )
    return exit
  },
})
