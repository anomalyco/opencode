import { TextAttributes, type CodeRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import stripAnsi from "strip-ansi"
import { useConfig } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { Keymap } from "../../context/keymap"
import { useTheme, useThemes } from "../../context/theme"
import { dialogWidth, useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { Locale } from "../../util/locale"
import { getScrollAcceleration } from "../../util/scroll"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

// The part is passed as a live accessor prop so the dialog follows the tool
// while child calls stream and the output arrives.
export function DialogExecute(props: { part: SessionMessageAssistantTool }) {
  const dialog = useDialog()
  const clipboard = useClipboard()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  const config = useConfig().data
  const [copied, setCopied] = createSignal<"code" | "output">()
  const [codeRows, setCodeRows] = createSignal(0)
  const [jsonRows, setJsonRows] = createSignal(0)
  const maxHeight = createMemo(() => Math.max(3, Math.floor(dimensions().height * 0.7) - 6))
  let scroll: ScrollBoxRenderable | undefined

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  const code = createMemo(() => executeCode(props.part.state.input))
  const text = createMemo(() => outputText(props.part.state))
  const highlighted = createMemo(() => {
    const value = text()
    return value ? highlightedOutput(value) : undefined
  })
  const failed = createMemo(() => {
    const state = props.part.state
    if (state.status === "error") return true
    if (state.status === "streaming") return false
    return state.metadata?.error === true
  })
  // Both blocks share one gutter width so their content starts on the same column.
  const digits = createMemo(() => String(Math.max(lineCount(code()), lineCount(highlighted()?.json), 1)).length)
  // Use the renderer's visual row counts so wrapping and terminal resizing also
  // update the dialog height without changing the source line numbers.
  const height = createMemo(() => {
    const width = Math.max(1, Math.min(dialogWidth(dialog.size), dimensions().width - 2) - 4)
    const body = highlighted()
    const outputRows = body
      ? (jsonRows() || lineCount(body.json)) + wrappedRows(body.rest, Math.max(1, width - digits() - 1))
      : wrappedRows(text(), width) || 1
    return Math.min(maxHeight(), (code() ? codeRows() || lineCount(code()) : 1) + outputRows + 3)
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
    const value = kind === "code" ? code() : text()
    if (!value) return
    void clipboard
      .write(value)
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
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} flexGrow={1}>
          execute
        </text>
        <text fg={failed() ? theme.text.feedback.error.base : theme.text.muted}>{status()}</text>
        <text fg={theme.text.muted} onMouseUp={() => dialog.clear()}>
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
            <text fg={theme.text.muted} attributes={TextAttributes.BOLD}>
              Code
            </text>
            <Show when={code()} fallback={<text fg={theme.text.muted}>Waiting for code…</text>}>
              {(value) => (
                <GutteredCode content={value()} filetype="typescript" digits={digits()} onRows={setCodeRows} />
              )}
            </Show>
          </box>
          <box>
            <text fg={theme.text.muted} attributes={TextAttributes.BOLD}>
              Output
            </text>
            <Show
              when={highlighted()}
              fallback={
                <text
                  fg={text() ? (failed() ? theme.text.feedback.error.base : theme.text.base) : theme.text.muted}
                  wrapMode="word"
                >
                  {text() ?? (props.part.state.status === "completed" ? "No output" : "Waiting for output…")}
                </text>
              }
            >
              {(body) => (
                <>
                  <GutteredCode content={body().json} filetype="json" digits={digits()} onRows={setJsonRows} />
                  <Show when={body().rest}>
                    {(rest) => (
                      <box paddingLeft={digits() + 1}>
                        <text fg={failed() ? theme.text.feedback.error.base : theme.text.base} wrapMode="word">
                          {rest()}
                        </text>
                      </box>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </box>
        </box>
      </scrollbox>
      <box flexDirection="row" gap={3} flexWrap="wrap">
        <text fg={theme.text.muted}>↑/↓ scroll</text>
        <text onMouseUp={() => copy("code")}>
          <span style={{ fg: copied() === "code" ? theme.text.feedback.success.base : theme.text.base }}>
            <b>{copied() === "code" ? "✓ copied" : "c"}</b>
          </span>
          <span style={{ fg: theme.text.muted }}>{copied() === "code" ? "" : " copy code"}</span>
        </text>
        <text onMouseUp={() => copy("output")}>
          <span style={{ fg: copied() === "output" ? theme.text.feedback.success.base : theme.text.base }}>
            <b>{copied() === "output" ? "✓ copied" : "o"}</b>
          </span>
          <span style={{ fg: theme.text.muted }}>{copied() === "output" ? "" : " copy output"}</span>
        </text>
        <text fg={theme.text.muted}>esc back</text>
      </box>
    </box>
  )
}

function executeCode(input: SessionMessageAssistantTool["state"]["input"]) {
  if (typeof input === "string") return
  return typeof input.code === "string" && input.code ? input.code : undefined
}

function outputText(state: SessionMessageAssistantTool["state"]) {
  if (state.status === "error") return state.error.message || undefined
  if (state.status !== "completed") return
  const text = stripAnsi(
    state.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .join("\n")
      .trim(),
  )
  return text || undefined
}

// The tool prints a JSON result, optionally followed by "\n\nWarnings:" and "\n\nLogs:".
function highlightedOutput(text: string) {
  if (!text.startsWith("{") && !text.startsWith("[")) return
  const end = text.search(/\n\n(Warnings|Logs):\n/)
  const json = end === -1 ? text : text.slice(0, end)
  if (Option.isNone(decodeJson(json))) return
  return { json, rest: text.slice(json.length).trim() || undefined }
}

function lineCount(text: string | undefined) {
  return text ? text.split("\n").length : 0
}

function wrappedRows(text: string | undefined, width: number) {
  if (!text) return 0
  return text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0)
}

// `<line_number>` right-aligns digits in a gutter sized to that block alone, so
// the column "1" starts on depends on the line count and differs between calls.
// One shared left-aligned gutter keeps the title and every line number on the
// same column, and keeps code and output on one content column. Continuations
// have an empty gutter; only the first visual row gets its source line number.
function GutteredCode(props: {
  content: string
  filetype: "typescript" | "json"
  digits: number
  onRows: (rows: number) => void
}) {
  const theme = useTheme().surface("dialog")
  const syntax = useThemes().currentSyntax
  const [sources, setSources] = createSignal(props.content.split("\n").map((_, index) => index))
  const gutter = createMemo(() =>
    sources()
      .map((source, index, lines) =>
        (index === 0 || source !== lines[index - 1] ? String(source + 1) : "").padEnd(props.digits),
      )
      .join("\n"),
  )

  return (
    <box flexDirection="row" gap={1} width="100%">
      <text fg={theme.text.muted} flexShrink={0} width={props.digits}>
        {gutter()}
      </text>
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        <code
          ref={(block: CodeRenderable) => {
            const update = () => {
              if (block.isDestroyed) return
              setSources(block.getLineSources(0, block.virtualLineCount))
              props.onRows(block.virtualLineCount)
            }
            // Native measurement finishes after the resize event is emitted.
            const schedule = () => queueMicrotask(update)
            block.on("line-info-change", schedule)
            onCleanup(() => block.off("line-info-change", schedule))
            schedule()
          }}
          width="100%"
          conceal={false}
          wrapMode="char"
          fg={theme.text.base}
          filetype={props.filetype}
          syntaxStyle={syntax()}
          content={props.content}
        />
      </box>
    </box>
  )
}
