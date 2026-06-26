import { createMemo, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import type { RGBA } from "@opentui/core"
import { contextPct } from "./usage"

const FILLED = "▓"
const EMPTY = "░"

export function ContextBar(props: { sessionID: Accessor<string | undefined>; width?: number }) {
  const sync = useSync()
  const { theme } = useTheme()
  const width = () => props.width ?? 10

  const pct = createMemo(() => {
    const id = props.sessionID()
    if (!id) return undefined
    return contextPct(id, sync)
  })

  const color = createMemo<RGBA>(() => {
    const p = pct()
    if (p === undefined) return theme.textMuted
    if (p < 70) return theme.success
    if (p < 90) return theme.warning
    return theme.error
  })

  const filled = createMemo(() => {
    const p = pct()
    if (p === undefined) return 0
    return Math.round((p / 100) * width())
  })

  const bar = createMemo(() => FILLED.repeat(filled()) + EMPTY.repeat(width() - filled()))

  return (
    <text fg={color()} wrapMode="none">
      {bar()} {pct() !== undefined ? `${pct()}%` : ""}
    </text>
  )
}

export * as WorkflowContextBar from "./context-bar"