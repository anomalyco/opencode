import { TextAttributes, type CodeRenderable, type ScrollBoxRenderable } from "@opentui/core"
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

  // The gutter is digits + 2 wide and its minWidth is fixed at construction, so
  // pad the block with fewer digits to keep code and output on one column.
  const digits = (text: string) => String(text ? text.split("\n").length : 0).length
  const pad = (own: string, other: string) => Math.max(0, digits(other) - digits(own))
  // Section titles sit over the first content character, past the shared gutter.
  const indent = createMemo(() => Math.max(3, Math.max(digits(code()), digits(sections().json)) + 2))

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
            <box paddingLeft={indent()}>
              <text fg={theme.text.subdued} attributes={TextAttributes.BOLD}>
                Code
              </text>
            </box>
            <Show when={code()} fallback={<text fg={theme.text.subdued}>Waiting for code…</text>}>
              <box paddingLeft={pad(code(), sections().json)}>
                <line_number fg={theme.text.subdued} minWidth={3} paddingRight={1}>
                  <code
                    ref={(block: CodeRenderable) => blocks.add(block)}
                    conceal={false}
                    wrapMode="none"
                    fg={theme.text.default}
                    filetype="typescript"
                    syntaxStyle={syntax()}
                    content={code()}
                  />
                </line_number>
              </box>
            </Show>
          </box>
          <box>
            <box paddingLeft={indent()}>
              <text fg={theme.text.subdued} attributes={TextAttributes.BOLD}>
                Output
              </text>
            </box>
            <Show
              when={output()}
              fallback={
                <text fg={theme.text.subdued}>
                  {props.part.state.status === "completed" ? "No output" : "Waiting for output…"}
                </text>
              }
            >
              <Show when={sections().json}>
                <box paddingLeft={pad(sections().json, code())}>
                  <line_number fg={theme.text.subdued} minWidth={3} paddingRight={1}>
                    <code
                      ref={(block: CodeRenderable) => blocks.add(block)}
                      conceal={false}
                      wrapMode="none"
                      fg={theme.text.default}
                      filetype="json"
                      syntaxStyle={syntax()}
                      content={sections().json}
                    />
                  </line_number>
                </box>
              </Show>
              <Show when={sections().rest}>
                <text fg={failed() ? theme.text.feedback.error.default : theme.text.default} wrapMode="word">
                  {sections().rest}
                </text>
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
