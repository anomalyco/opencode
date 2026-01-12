import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    return async (reason?: any) => {
      // macOS terminal restoration
      try {
        // Reset terminal to known good state
        process.stdout.write("\x1bc") // Reset terminal
        process.stdout.write("\x1b[?1049l") // Restore normal screen buffer
        process.stdout.write("\x1b[?47l") // Disable alternate screen
        process.stdout.write("\x1b[0m") // Reset attributes
        process.stdout.write("\x1b[2J") // Clear screen
        process.stdout.write("\x1b[H") // Move cursor to top-left
      } catch (e) {
        // Ignore write errors during shutdown
      }

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
