import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { win32FlushInputBuffer } from "../win32"
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onBeforeExit?: () => Promise<void>; onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let message: string | undefined
    let task: Promise<void> | undefined
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
      (reason?: unknown) => {
        if (task) return task
        task = (async () => {
          await input.onBeforeExit?.()
          // Reset window title before destroying renderer
          renderer.setTerminalTitle("")
          // Disable mouse tracking synchronously before destroy.
          // renderer.destroy() may defer native cleanup when called during a
          // render frame, so we also register a process 'exit' handler as a
          // last-resort safeguard that runs right before the process terminates.
          const MOUSE_RESET =
            "\x1b[?1003l" + // disable any-event mouse tracking
            "\x1b[?1006l" + // disable SGR mouse mode
            "\x1b[?1000l" + // disable normal mouse tracking
            "\x1b[?25h" // show cursor
          process.stdout.write(MOUSE_RESET)
          renderer.destroy()
          win32FlushInputBuffer()
          if (reason) {
            const formatted = FormatError(reason) ?? FormatUnknownError(reason)
            if (formatted) {
              process.stderr.write(formatted + "\n")
            }
          }
          const text = store.get()
          if (text) process.stdout.write(text + "\n")
          await input.onExit?.()
        })()
        return task
      },
      {
        message: store,
      },
    )
    process.on("SIGHUP", () => exit())
    // Last-resort: if process.exit() fires before renderer cleanup finishes,
    // 'exit' event still runs synchronously and can write terminal reset sequences.
    process.on("exit", () => {
      process.stdout.write(
        "\x1b[?1003l" + // disable any-event mouse tracking
          "\x1b[?1006l" + // disable SGR mouse mode
          "\x1b[?1000l" + // disable normal mouse tracking
          "\x1b[?25h", // show cursor
      )
    })
    return exit
  },
})
