import { createMemo, createSignal, For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TIPS } from "./tips"

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

export function DidYouKnow() {
  const { theme } = useTheme()

  const tipParts = createMemo(() => parseTip(TIPS[tipIndex()]))

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● Tip{" "}
      </text>
      <text flexShrink={1}>
        <For each={tipParts()}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}
