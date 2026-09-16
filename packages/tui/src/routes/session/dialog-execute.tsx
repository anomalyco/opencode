import { CliRenderEvents, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { createEffect, createMemo, createResource, createSignal, onCleanup, Show, untrack } from "solid-js"
import stripAnsi from "strip-ansi"
import { useConfig } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { Keymap } from "../../context/keymap"
import { useTheme, useThemes } from "../../context/theme"
import { dialogWidth, useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { Locale } from "../../util/locale"
import { getScrollAcceleration } from "../../util/scroll"
import { toolDisplayContent, toolDisplayMetadata } from "../../util/tool-display"

// The part is passed as a live accessor prop so the dialog follows the tool
// while child calls stream and the output arrives.
export function DialogExecute(props: { part: SessionMessageAssistantTool }) {
  const dialog = useDialog()
  const clipboard = useClipboard()
  const toast = useToast()
  const theme = useTheme("elevated")
  const { currentSyntax: syntax } = useThemes()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const [copied, setCopied] = createSignal<"code" | "output">()
  const [height, setHeight] = createSignal(1)
  const maxHeight = createMemo(() => Math.max(3, Math.floor(dimensions().height * 0.7) - 6))
  let scroll: ScrollBoxRenderable | undefined

  // Fit the scroll area to its content up to the cap. Wrapped code settles a
  // frame after mount and output streams in, so grow from the measured height
  // on every frame instead of measuring once; a resize restarts the fit.
  createEffect(() => {
    dimensions()
    setHeight(1)
  })
  const measure = () => {
    if (!scroll) return
    const next = Math.max(1, Math.min(maxHeight(), scroll.scrollHeight))
    if (next > untrack(height)) setHeight(next)
  }
  renderer.on(CliRenderEvents.FRAME, measure)
  onCleanup(() => renderer.off(CliRenderEvents.FRAME, measure))

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  const code = createMemo(() => {
    const input = props.part.state.input
    if (typeof input === "string") return ""
    return typeof input.code === "string" ? input.code : ""
  })
  // Models often emit the program on one line. Reformat it for reading and fall
  // back to the raw source while formatting runs or when it does not parse yet.
  const printWidth = createMemo(() => Math.min(dialogWidth(dialog.size), dimensions().width - 2) - 8)
  const [formatted] = createResource(
    () => [code(), printWidth()] as const,
    async ([source, width]) => ({ source, text: await prettify(source, width) }),
  )
  const display = createMemo(() => {
    const result = formatted.latest
    return result?.source === code() ? result.text : code()
  })
  const failed = createMemo(
    () => toolDisplayMetadata(props.part.state).error === true || props.part.state.status === "error",
  )
  const output = createMemo(() => {
    const state = props.part.state
    if (state.status === "error") return state.error.message
    return stripAnsi(
      toolDisplayContent(state)
        .flatMap((item) => (item.type === "text" ? [item.text] : []))
        .join("\n")
        .trim(),
    )
  })
  const status = createMemo(() => {
    const state = props.part.state
    if (state.status === "streaming") return "Receiving code…"
    if (state.status === "running") return "Running"
    const duration = props.part.time.completed
      ? ` · ${Locale.duration(props.part.time.completed - (props.part.time.ran ?? props.part.time.created))}`
      : ""
    if (failed()) return `Failed${duration}`
    return `Completed${duration}`
  })

  const copy = (kind: "code" | "output") => {
    const text = kind === "code" ? display() : output()
    if (!text) return
    void clipboard
      .write(text)
      .then(() => setCopied(kind))
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "up", title: "Scroll up", group: "Execute", run: () => scroll?.scrollBy(-1) },
      { bind: "down", title: "Scroll down", group: "Execute", run: () => scroll?.scrollBy(1) },
      { bind: "pageup", title: "Previous page", group: "Execute", run: () => scroll?.scrollBy(-maxHeight()) },
      { bind: "pagedown", title: "Next page", group: "Execute", run: () => scroll?.scrollBy(maxHeight()) },
      { bind: "home", title: "Scroll to code", group: "Execute", run: () => scroll?.scrollTo(0) },
      { bind: "end", title: "Scroll to output", group: "Execute", run: () => scroll?.scrollTo(Infinity) },
      { bind: "c", title: "Copy code", group: "Execute", run: () => copy("code") },
      { bind: "o", title: "Copy output", group: "Execute", run: () => copy("output") },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.default} attributes={TextAttributes.BOLD} flexGrow={1}>
          execute
        </text>
        <text fg={failed() ? theme.text.feedback.error.default : theme.text.subdued}>{status()}</text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox
        id="execute-detail-scroll"
        ref={(value: ScrollBoxRenderable) => (scroll = value)}
        height={height()}
        scrollbarOptions={{ visible: false }}
        scrollAcceleration={getScrollAcceleration(config)}
      >
        <box gap={1}>
          <box>
            <text fg={theme.text.subdued} attributes={TextAttributes.BOLD}>
              Code
            </text>
            <Show when={code()} fallback={<text fg={theme.text.subdued}>Waiting for code…</text>}>
              <line_number fg={theme.text.subdued} minWidth={3} paddingRight={1}>
                <code
                  conceal={false}
                  fg={theme.text.default}
                  filetype="typescript"
                  syntaxStyle={syntax()}
                  content={display()}
                />
              </line_number>
            </Show>
          </box>
          <box>
            <text fg={theme.text.subdued} attributes={TextAttributes.BOLD}>
              Output
            </text>
            <Show
              when={output()}
              fallback={
                <text fg={theme.text.subdued}>
                  {props.part.state.status === "completed" ? "No output" : "Waiting for output…"}
                </text>
              }
            >
              <text fg={failed() ? theme.text.feedback.error.default : theme.text.default} wrapMode="word">
                {output()}
              </text>
            </Show>
          </box>
        </box>
      </scrollbox>
      <box flexDirection="row" gap={3} flexWrap="wrap">
        <text fg={theme.text.subdued}>↑/↓ scroll</text>
        <text onMouseUp={() => copy("code")}>
          <span style={{ fg: copied() === "code" ? theme.text.feedback.success.default : theme.text.default }}>
            <b>{copied() === "code" ? "✓ copied" : "c"}</b>
          </span>
          <span style={{ fg: theme.text.subdued }}>{copied() === "code" ? "" : " copy code"}</span>
        </text>
        <text onMouseUp={() => copy("output")}>
          <span style={{ fg: copied() === "output" ? theme.text.feedback.success.default : theme.text.default }}>
            <b>{copied() === "output" ? "✓ copied" : "o"}</b>
          </span>
          <span style={{ fg: theme.text.subdued }}>{copied() === "output" ? "" : " copy output"}</span>
        </text>
        <text fg={theme.text.subdued}>esc back</text>
      </box>
    </box>
  )
}

async function prettify(source: string, printWidth: number) {
  if (!source) return source
  const { format } = await import("prettier/standalone")
  const { default: babel } = await import("prettier/plugins/babel")
  const { default: estree } = await import("prettier/plugins/estree")
  return format(source, {
    parser: "babel",
    plugins: [babel, estree],
    printWidth: Math.max(40, printWidth),
    semi: false,
  })
    .then((text) => text.trimEnd())
    .catch(() => source)
}
