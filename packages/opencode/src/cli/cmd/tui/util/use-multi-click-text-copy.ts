import { useRenderer } from "@opentui/solid"
import { type MouseEvent, type Renderable } from "@opentui/core"
import { createMultiClickDetector } from "./multi-click"
import { extractWordAtPosition, extractLineAtPosition } from "./text-boundaries"
import { Clipboard } from "./clipboard"
import { type useToast } from "../ui/toast"

interface UseMultiClickTextCopyOptions {
  getText: () => string
  toast: ReturnType<typeof useToast>
}

export function useMultiClickTextCopy(options: UseMultiClickTextCopyOptions) {
  const renderer = useRenderer()

  const copyText = async (text: string, type: "word" | "line") => {
    // Copy via OSC52 for terminal compatibility
    const base64 = Buffer.from(text).toString("base64")
    const osc52 = `\x1b]52;c;${base64}\x07`
    const finalOsc52 = process.env["TMUX"] ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
    // @ts-expect-error writeOut is not in type definitions
    renderer.writeOut(finalOsc52)

    // Copy via native clipboard
    await Clipboard.copy(text)
      .then(() => {
        options.toast.show({
          message: type === "word" ? "Word copied!" : "Line copied!",
          variant: "info",
          duration: 2000,
        })
      })
      .catch(() => {
        options.toast.show({
          message: "Failed to copy",
          variant: "error",
          duration: 2000,
        })
      })
  }

  // Store the current event target for callbacks
  // The callbacks are synchronous so this is safe
  const state = { target: null as Renderable | null }

  const detectMultiClick = createMultiClickDetector(
    (x, y) => {
      const text = options.getText()
      const target = state.target
      if (!text || !target) return

      const word = extractWordAtPosition(x, y, text, target.x, target.y)
      if (word) copyText(word, "word")
    },
    (x, y) => {
      const text = options.getText()
      const target = state.target
      if (!text || !target) return

      const line = extractLineAtPosition(y, text, target.y)
      if (line) copyText(line, "line")
    },
  )

  const onMouseUp = (event: MouseEvent) => {
    // Don't interfere with text selection
    if (renderer.getSelection()?.getSelectedText()) return

    state.target = event.target
    detectMultiClick(event.x, event.y)
  }

  return { onMouseUp }
}
