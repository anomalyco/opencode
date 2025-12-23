import { createMemo, createSignal, For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { TIPS } from "./tips"
import { EmptyBorder } from "./border"

type TipPart = { text: string; highlight: boolean }

function parseTip(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(tip)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: tip.slice(lastIndex, match.index), highlight: false })
    }
    parts.push({ text: match[1], highlight: true })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < tip.length) {
    parts.push({ text: tip.slice(lastIndex), highlight: false })
  }

  return parts
}

const [tipIndex, setTipIndex] = createSignal(Math.floor(Math.random() * TIPS.length))

export function randomizeTip() {
  setTipIndex(Math.floor(Math.random() * TIPS.length))
}

const BOX_WIDTH = 42
const TITLE = " 🅘 Did you know? "

export function DidYouKnow() {
  const { theme } = useTheme()
  const keybind = useKeybind()

  const tipParts = createMemo(() => parseTip(TIPS[tipIndex()]))

  const dashes = createMemo(() => {
    // ╭─ + title + ─...─ + ╮ = BOX_WIDTH
    // 1 + 1 + title.length + dashes + 1 = BOX_WIDTH
    return Math.max(0, BOX_WIDTH - 2 - TITLE.length - 1)
  })

  return (
    <box position="absolute" bottom={3} right={2} width={BOX_WIDTH}>
      <text>
        <span style={{ fg: theme.border }}>╭─</span>
        <span style={{ fg: theme.text }}>{TITLE}</span>
        <span style={{ fg: theme.border }}>{"─".repeat(dashes())}╮</span>
      </text>
      <box
        border={["left", "right", "bottom"]}
        borderColor={theme.border}
        customBorderChars={{
          ...EmptyBorder,
          bottomLeft: "╰",
          bottomRight: "╯",
          horizontal: "─",
          vertical: "│",
        }}
      >
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text>
            <For each={tipParts()}>
              {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
            </For>
          </text>
        </box>
      </box>
      <box flexDirection="row" justifyContent="flex-end">
        <text>
          <span style={{ fg: theme.text }}>{keybind.print("tips_toggle")}</span>
          <span style={{ fg: theme.textMuted }}> hide tips</span>
        </text>
      </box>
    </box>
  )
}
