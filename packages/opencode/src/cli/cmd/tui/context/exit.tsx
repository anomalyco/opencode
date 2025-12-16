import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    return async (reason?: any) => {
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
    }
  },
})
