import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { ExitMessage } from "../exit-message"

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
        process.exit(0)
      },
      {
        message: {
          set: ExitMessage.set,
          clear: ExitMessage.clear,
          get: ExitMessage.get,
        },
      },
    )
    return exit
  },
})
