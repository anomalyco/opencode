import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    return async (reason?: any) => {
      // Disable SGR mouse tracking to prevent ASCII codes appearing after exit
      // These sequences disable various mouse tracking modes that opentui may have enabled
      const disableMouseTracking = [
        "\x1b[?1000l", // Disable basic mouse tracking
        "\x1b[?1002l", // Disable button-event mouse tracking
        "\x1b[?1005l", // Disable SGR mouse tracking
        "\x1b[?1006l", // Disable SGR 1006 mode
        "\x1b[?1015l", // Disable URXVT mouse tracking
        "\x1b[?1003l", // Disable all motion tracking
      ]

      // Send all disable sequences to ensure mouse tracking is disabled
      for (const seq of disableMouseTracking) {
        process.stdout.write(seq)
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
