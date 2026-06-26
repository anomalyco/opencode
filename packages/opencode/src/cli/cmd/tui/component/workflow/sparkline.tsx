import { createMemo, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

export function Sparkline(props: { history: Accessor<number[]>; width?: number }) {
  const { theme } = useTheme()
  const width = () => props.width ?? 12
  const render = createMemo(() => {
    const history = props.history()
    if (history.length === 0) return ""
    const slice = history.slice(-width())
    const max = Math.max(1, ...slice)
    return slice
      .map((v) => {
        if (v <= 0) return " "
        const idx = Math.min(BLOCKS.length - 1, Math.round((v / max) * (BLOCKS.length - 1)))
        return BLOCKS[idx]
      })
      .join("")
  })
  return (
    <text fg={theme.textMuted} wrapMode="none">
      {render()}
    </text>
  )
}

export * as WorkflowSparkline from "./sparkline"