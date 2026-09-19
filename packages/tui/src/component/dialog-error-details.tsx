import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { useConfig } from "../config"
import { useClipboard } from "../context/clipboard"
import { Keymap } from "../context/keymap"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { getScrollAcceleration } from "../util/scroll"
import { useTheme } from "../context/theme"
import { emptyPrompt } from "../prompt/history"
import { dialogWidth, useDialog } from "../ui/dialog"
import { FilePath } from "../ui/file-path"
import { useToast } from "../ui/toast"
import { errorDetails } from "../util/error-details"

export function DialogErrorDetails(props: {
  title: string
  source?: string
  error: string
  context?: string
  diagnosticRef?: string
  onBack: () => void
}) {
  const clipboard = useClipboard()
  const dialog = useDialog()
  const location = useLocation()
  const route = useRoute()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const [copied, setCopied] = createSignal(false)
  let scroll: ScrollBoxRenderable | undefined

  const copy = () => {
    void clipboard
      .write(errorDetails(props).text)
      .then(() => setCopied(true))
      .catch(toast.error)
  }

  const investigate = () => {
    route.navigate({
      type: "home",
      location: location.ref,
      prompt: {
        ...emptyPrompt(),
        text: errorDetails(props).prompt,
      },
    })
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "escape", title: "Back", group: "Dialog", run: props.onBack },
      { bind: "c", title: "Copy details", group: "Dialog", run: copy },
      { bind: "i", title: "Investigate error", group: "Dialog", run: investigate },
    ],
  }))

  useKeyboard((event) => {
    if (event.name === "up") return scroll?.scrollBy(-1)
    if (event.name === "down") return scroll?.scrollBy(1)
    if (event.name === "pageup") return scroll?.scrollBy(-20)
    if (event.name === "pagedown") return scroll?.scrollBy(20)
    if (event.name === "home") return scroll?.scrollTo(0)
    if (event.name === "end" && scroll) return scroll.scrollTo(scroll.scrollHeight)
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box>
        <box flexDirection="row" gap={2}>
          <text
            attributes={TextAttributes.BOLD}
            fg={theme.text.base}
            flexGrow={1}
            minWidth={0}
            wrapMode="none"
            truncate
          >
            {props.title}
          </text>
          <text fg={theme.text.muted} flexShrink={0} onMouseUp={props.onBack}>
            esc
          </text>
        </box>
        <Show when={props.source}>
          {(source) => (
            <FilePath
              value={source()}
              maxWidth={Math.min(dialogWidth(dialog.size), dimensions().width - 2) - 4}
              fg={theme.text.muted}
            />
          )}
        </Show>
      </box>
      <box>
        <scrollbox
          ref={(element: ScrollBoxRenderable) => (scroll = element)}
          maxHeight={20}
          contentOptions={{ minHeight: 0 }}
          scrollbarOptions={{ visible: false }}
          scrollAcceleration={getScrollAcceleration(config)}
        >
          <text fg={theme.text.base} wrapMode="word">
            {props.error}
          </text>
        </scrollbox>
        <Show when={props.diagnosticRef}>
          <text fg={theme.text.muted}>Reference: {props.diagnosticRef}</text>
        </Show>
      </box>
      <box flexDirection="row" gap={3} flexWrap="wrap">
        <text onMouseUp={investigate}>
          <span style={{ fg: theme.text.base }}>
            <b>i</b>
          </span>
          <span style={{ fg: theme.text.muted }}> investigate</span>
        </text>
        <text onMouseUp={copy}>
          <span style={{ fg: copied() ? theme.text.feedback.success.base : theme.text.base }}>
            <b>{copied() ? "✓ copied" : "c"}</b>
          </span>
          <span style={{ fg: theme.text.muted }}>{copied() ? "" : " copy details"}</span>
        </text>
        <text fg={theme.text.muted}>↑/↓ scroll</text>
      </box>
    </box>
  )
}
