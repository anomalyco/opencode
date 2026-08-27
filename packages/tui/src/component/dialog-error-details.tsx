import { CliRenderEvents, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../config"
import { useClipboard } from "../context/clipboard"
import { Keymap } from "../context/keymap"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { getScrollAcceleration } from "../util/scroll"
import { useTheme } from "../context/theme"
import { emptyPrompt } from "../prompt/history"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"

export function DialogErrorDetails(props: { title: string; error: string; context?: string; onBack: () => void }) {
  const clipboard = useClipboard()
  const dialog = useDialog()
  const location = useLocation()
  const route = useRoute()
  const toast = useToast()
  const theme = useTheme("elevated")
  const overlayTheme = useTheme("overlay")
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const [copied, setCopied] = createSignal(false)
  const [scrollable, setScrollable] = createSignal(false)
  const [height, setHeight] = createSignal(1)
  const maxHeight = createMemo(() => Math.max(3, Math.floor(dimensions().height / 2) - 5))
  let scroll: ScrollBoxRenderable | undefined
  let measure: (() => void) | undefined

  createEffect(() => {
    dimensions()
    props.error
    if (measure) renderer.off(CliRenderEvents.FRAME, measure)
    measure = () => {
      measure = undefined
      if (!scroll) return
      const next = Math.max(1, Math.min(maxHeight(), scroll.scrollHeight))
      setHeight(next)
      setScrollable(scroll.scrollHeight > next)
    }
    renderer.once(CliRenderEvents.FRAME, measure)
    renderer.requestRender()
  })

  onCleanup(() => {
    if (measure) renderer.off(CliRenderEvents.FRAME, measure)
  })

  const copy = () => {
    void clipboard
      .write(props.error)
      .then(() => setCopied(true))
      .catch(toast.error)
  }

  const investigate = () => {
    route.navigate({
      type: "home",
      location: location.ref,
      prompt: {
        ...emptyPrompt(),
        text: `Investigate why this OpenCode component failed in the current project.\n\n${props.title}${props.context ? `\n${props.context}` : ""}\nError: ${props.error}\n\nInspect the relevant project and global OpenCode configuration, startup or loading behavior, required environment variables or credentials, dependencies, and logs. Identify the root cause and recommend a fix.`,
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
    if (!scrollable()) return
    if (event.name === "up") return scroll?.scrollBy(-1)
    if (event.name === "down") return scroll?.scrollBy(1)
    if (event.name === "pageup") return scroll?.scrollBy(-maxHeight())
    if (event.name === "pagedown") return scroll?.scrollBy(maxHeight())
    if (event.name === "home") return scroll?.scrollTo(0)
    if (event.name === "end" && scroll) return scroll.scrollTo(scroll.scrollHeight)
  })

  return (
    <box paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          {props.title}
        </text>
        <text fg={theme.text.subdued} onMouseUp={props.onBack}>
          esc
        </text>
      </box>
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
      <box flexDirection="row" gap={3} paddingLeft={2} paddingRight={2}>
        <text flexGrow={1}>
          <span style={{ fg: theme.text.default }}>
            <b>{scrollable() ? "↑/↓" : ""}</b>
          </span>
          <span style={{ fg: theme.text.subdued }}>{scrollable() ? " scroll" : ""}</span>
        </text>
        <text onMouseUp={investigate}>
          <span style={{ fg: theme.text.default }}>
            <b>i</b>
          </span>
          <span style={{ fg: theme.text.subdued }}> investigate</span>
        </text>
        <text onMouseUp={copy}>
          <span style={{ fg: copied() ? theme.text.feedback.success.default : theme.text.default }}>
            <b>{copied() ? "✓ copied" : "c"}</b>
          </span>
          <span style={{ fg: theme.text.subdued }}>{copied() ? "" : " copy details"}</span>
        </text>
      </box>
    </box>
  )
}
