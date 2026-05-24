import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import { useRenderer } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import type { AssistantMessage, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { createMemo, createSignal, For, Show } from "solid-js"

const COLLAPSED_LINES = 2
const EXPANDED_LINES = 8
const CONTROL_WIDTH = 10
const MIN_LINE_WIDTH = 20

const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

export type StickyPromptTurn = {
  user: UserMessage
  parts: Part[]
  target: AssistantMessage
}

function charWidth(char: string) {
  if (/[\u0300-\u036f]/.test(char)) return 0
  if (
    /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(
      char,
    )
  )
    return 2
  return 1
}

function wrapText(text: string, columns: number) {
  return text.split(/\r?\n/).flatMap((line) => {
    const lines: string[] = []
    let current = ""
    let currentWidth = 0
    for (const char of line) {
      const charColumns = charWidth(char)
      if (current && currentWidth + charColumns > columns) {
        lines.push(current)
        current = char
        currentWidth = charColumns
        continue
      }
      current += char
      currentWidth += charColumns
    }
    return current ? [...lines, current] : lines
  })
}

export function StickyUserPrompt(props: {
  turn: StickyPromptTurn
  expanded: boolean
  width: number
  showTimestamps: boolean
  color: RGBA
  onExpand: () => void
  onJump: () => void
}) {
  const renderer = useRenderer()
  const { theme } = useTheme()
  const [hoverJump, setHoverJump] = createSignal(false)
  const [hoverExpand, setHoverExpand] = createSignal(false)
  const text = createMemo(() =>
    props.turn.parts
      .map((part) => {
        if (part.type !== "text") return
        if (part.synthetic) return
        return part.text
      })
      .filter(Boolean)
      .join("\n\n")
      .trim(),
  )
  const files = createMemo(() => props.turn.parts.flatMap((part) => (part.type === "file" ? [part] : [])))
  const lines = createMemo(() => wrapText(text(), Math.max(MIN_LINE_WIDTH, props.width - CONTROL_WIDTH)))
  const overflow = createMemo(() => lines().length > COLLAPSED_LINES)
  const shown = createMemo(() => lines().slice(0, props.expanded ? EXPANDED_LINES : COLLAPSED_LINES))
  const buttonBg = createMemo(() => (hoverJump() ? theme.backgroundMenu : theme.backgroundElement))
  const expandBg = createMemo(() => (hoverExpand() ? theme.backgroundMenu : theme.backgroundElement))

  return (
    <Show when={text()}>
      <box
        border={["left"]}
        borderColor={props.color}
        customBorderChars={SplitBorder.customBorderChars}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        marginTop={1}
        marginBottom={1}
        flexShrink={0}
        zIndex={10}
      >
        <box flexDirection="row" gap={1}>
          <box flexGrow={1} minWidth={0}>
            <For each={shown()}>
              {(line) => (
                <text fg={theme.text} wrapMode="none" truncate>
                  {line}
                </text>
              )}
            </For>
            <Show when={props.expanded && files().length}>
              <box flexDirection="row" paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => (
                    <text fg={theme.text}>
                      <span style={{ bg: theme.secondary, fg: theme.background }}>
                        {" "}
                        {MIME_BADGE[file.mime] ?? file.mime}{" "}
                      </span>
                      <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                    </text>
                  )}
                </For>
              </box>
            </Show>
            <Show when={props.expanded && props.showTimestamps}>
              <text fg={theme.textMuted}>{Locale.todayTimeOrDateTime(props.turn.user.time.created)}</text>
            </Show>
          </box>
          <box flexShrink={0} flexDirection="row" gap={1}>
            <Show when={overflow() || props.expanded}>
              <text
                fg={theme.textMuted}
                bg={expandBg()}
                paddingLeft={1}
                paddingRight={1}
                onMouseOver={() => setHoverExpand(true)}
                onMouseOut={() => setHoverExpand(false)}
                onMouseUp={() => {
                  if (renderer.getSelection()?.getSelectedText()) return
                  props.onExpand()
                }}
              >
                {props.expanded ? "[-]" : "[+]"}
              </text>
            </Show>
            <text
              fg={theme.text}
              bg={buttonBg()}
              paddingLeft={1}
              paddingRight={1}
              onMouseOver={() => setHoverJump(true)}
              onMouseOut={() => setHoverJump(false)}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                props.onJump()
              }}
            >
              [^]
            </text>
          </box>
        </box>
      </box>
    </Show>
  )
}
