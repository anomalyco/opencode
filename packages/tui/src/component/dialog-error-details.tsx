import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onMount } from "solid-js"
import { useConfig } from "../config"
import { useClipboard } from "../context/clipboard"
import { Keymap } from "../context/keymap"
import { getScrollAcceleration } from "../util/scroll"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"

export function DialogErrorDetails(props: { title: string; error: string; onBack: () => void }) {
  const dialog = useDialog()
  const clipboard = useClipboard()
  const toast = useToast()
  const theme = useTheme("elevated")
  const overlayTheme = useTheme("overlay")
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const [copied, setCopied] = createSignal(false)
  const height = createMemo(() => Math.max(3, Math.floor(dimensions().height / 2) - 5))
  let scroll: ScrollBoxRenderable | undefined

  onMount(() => dialog.setSize("large"))

  const copy = () => {
    void clipboard
      .write(props.error)
      .then(() => setCopied(true))
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: "escape", title: "Back", group: "Dialog", run: props.onBack }],
  }))

  useKeyboard((event) => {
    if (event.name === "c") return copy()
    if (event.name === "up") return scroll?.scrollBy(-1)
    if (event.name === "down") return scroll?.scrollBy(1)
    if (event.name === "pageup") return scroll?.scrollBy(-height())
    if (event.name === "pagedown") return scroll?.scrollBy(height())
    if (event.name === "home") return scroll?.scrollTo(0)
    if (event.name === "end" && scroll) return scroll.scrollTo(scroll.scrollHeight)
  })

  return (
    <box paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          {props.title}
        </text>
        <text fg={theme.text.subdued} onMouseUp={props.onBack}>
          esc back
        </text>
      </box>
      <text fg={theme.text.feedback.error.default}>✗ Failed</text>
      <box
        backgroundColor={overlayTheme.background.default}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <scrollbox
          ref={(element: ScrollBoxRenderable) => (scroll = element)}
          height={height()}
          scrollbarOptions={{ visible: false }}
          scrollAcceleration={getScrollAcceleration(config)}
        >
          <text fg={overlayTheme.text.default} wrapMode="word">
            {props.error}
          </text>
        </scrollbox>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.subdued}>↑↓ scroll</text>
        <text fg={theme.text.subdued} onMouseUp={copy}>
          {copied() ? "✓ copied" : "c copy details"}
        </text>
      </box>
    </box>
  )
}
