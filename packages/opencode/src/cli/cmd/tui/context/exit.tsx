import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { useToast } from "../ui/toast"

const TIMEOUT = 2000

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    const toast = useToast()
    let pending: number | null = null

    const exit = async (reason?: any) => {
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

    return async (reason?: any, force = false) => {
      if (force) return exit(reason)

      const now = Date.now()
      if (pending && now - pending < TIMEOUT) return exit(reason)

      pending = now
      setTimeout(() => {
        pending = null
      }, TIMEOUT)
      toast.show({
        title: "Exit",
        message: "Press Ctrl+C again to exit",
        variant: "warning",
        duration: TIMEOUT,
      })
    }
  },
})
