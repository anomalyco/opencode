import {
  TextAttributes,
  type CodeRenderable,
  type RGBA,
  type ScrollBoxRenderable,
  type SyntaxStyle,
} from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { createMemo, createSignal, Show } from "solid-js"
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

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

// The part is passed as a live accessor prop so the dialog follows the tool
// while child calls stream and the output arrives.
export function DialogExecute(props: { part: SessionMessageAssistantTool }) {
  const dialog = useDialog()
  const clipboard = useClipboard()
  const toast = useToast()
  const theme = useTheme("elevated")
  const { currentSyntax: syntax } = useThemes()
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const [copied, setCopied] = createSignal<"code" | "output">()
  const maxHeight = createMemo(() => Math.max(3, Math.floor(dimensions().height * 0.7) - 6))
  let scroll: ScrollBoxRenderable | undefined
  // Unwrapped <code> clips long lines and scrolls them itself. Each block clamps
  // to its own width, so drive both from one shared offset or the narrower block
  // stops early and the two drift apart on the way back.
  const blocks = new Set<CodeRenderable>()
  let panX = 0
  const pan = (delta: number) => {
    const max = Math.max(0, ...[...blocks].map((block) => block.scrollWidth - block.width))
    panX = Math.max(0, Math.min(max, panX + delta))
    blocks.forEach((block) => (block.scrollX = panX))
  }

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  const code = createMemo(() => {
    const input = props.part.state.input
    if (typeof input === "string") return ""
    return typeof input.code === "string" ? input.code : ""
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
  // The tool prints a JSON result, optionally followed by "\n\nWarnings:" and
  // "\n\nLogs:" sections. Highlight the JSON and keep any trailing text plain.
  const sections = createMemo(() => {
    const text = output()
    if (!text.startsWith("{") && !text.startsWith("[")) return { json: "", rest: text }
    const end = text.search(/\n\n(Warnings|Logs):\n/)
    const json = end === -1 ? text : text.slice(0, end)
    const parsed = decodeJson(json)
    if (Option.isNone(parsed)) return { json: "", rest: text }
    return { json, rest: text.slice(json.length).trim() }
  })
  // Code and JSON never wrap, so the content height is known up front. Sizing
  // synchronously lets the dialog open complete instead of growing over frames.
  const height = createMemo(() => {
    const lines = (text: string) => (text ? text.split("\n").length : 1)
    const width = Math.max(20, Math.min(dialogWidth(dialog.size), dimensions().width - 2) - 4)
    const rest = sections().rest
      ? sections()
          .rest.split("\n")
          .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0)
      : 0
    const outputRows = output() ? (sections().json ? lines(sections().json) : 0) + rest : 1
    return Math.min(maxHeight(), 1 + lines(code()) + 1 + 1 + outputRows)
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
    const text = kind === "code" ? code() : output()
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
      { bind: "left", title: "Scroll left", group: "Execute", run: () => pan(-8) },
      { bind: "right", title: "Scroll right", group: "Execute", run: () => pan(8) },
      { bind: "home", title: "Scroll to code", group: "Execute", run: () => scroll?.scrollTo(0) },
      { bind: "end", title: "Scroll to output", group: "Execute", run: () => scroll?.scrollTo(Infinity) },
      { bind: "c", title: "Copy code", group: "Execute", run: () => copy("code") },
      { bind: "o", title: "Copy output", group: "Execute", run: () => copy("output") },
    ],
  }))

  // Both blocks share one gutter width so their content starts on the same
  // column. The width only reserves digits; it does not shift the left edge.
  const digits = createMemo(() => String(Math.max(lineCount(code()), lineCount(sections().json), 1)).length)
  const source = (content: string, filetype: string) => (
    <NumberedSource
      content={content}
      filetype={filetype}
      digits={digits()}
      fg={theme.text.default}
      muted={theme.text.subdued}
      syntax={syntax()}
      register={(block) => blocks.add(block)}
    />
  )

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
              {source(code(), "typescript")}
            </Show>
          </box>
          <box>
            <text fg={theme.text.subdued} attributes={TextAttributes.BOLD}>
              Output
            </text>
            <Show
              when={sections().json}
              fallback={
                <text
                  fg={
                    output() ? (failed() ? theme.text.feedback.error.default : theme.text.default) : theme.text.subdued
                  }
                  wrapMode="word"
                >
                  {output()
                    ? sections().rest
                    : props.part.state.status === "completed"
                      ? "No output"
                      : "Waiting for output…"}
                </text>
              }
            >
              {source(sections().json, "json")}
              <Show when={sections().rest}>
                <box paddingLeft={digits() + 1}>
                  <text fg={failed() ? theme.text.feedback.error.default : theme.text.default} wrapMode="word">
                    {sections().rest}
                  </text>
                </box>
              </Show>
            </Show>
          </box>
        </box>
      </scrollbox>
      <box flexDirection="row" gap={3} flexWrap="wrap">
        <text fg={theme.text.subdued}>↑/↓ ←/→ scroll</text>
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

function lineCount(text: string) {
  return text ? text.split("\n").length : 0
}

// `<line_number>` right-aligns digits in a gutter sized to that block alone, so
// the column "1" starts on depends on how many lines the block has. Padding a
// title to chase that column slides it between calls and never sits on the
// numbers actually on screen. A shared left-aligned gutter keeps the title and
// every line number on one column, in every call.
function NumberedSource(props: {
  content: string
  filetype: string
  digits: number
  fg: RGBA
  muted: RGBA
  syntax: SyntaxStyle
  register: (block: CodeRenderable) => void
}) {
  const gutter = createMemo(() =>
    props.content
      .split("\n")
      .map((_, index) => String(index + 1).padEnd(props.digits))
      .join("\n"),
  )

  return (
    <box flexDirection="row" gap={1} width="100%">
      <text fg={props.muted} flexShrink={0} width={props.digits}>
        {gutter()}
      </text>
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        <code
          ref={props.register}
          width="100%"
          conceal={false}
          wrapMode="none"
          fg={props.fg}
          filetype={props.filetype}
          syntaxStyle={props.syntax}
          content={props.content}
        />
      </box>
    </box>
  )
}
