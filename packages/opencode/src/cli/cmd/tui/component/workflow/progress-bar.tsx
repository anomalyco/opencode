import { createMemo, Show, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { RGBA } from "@opentui/core"

type ColorKey = keyof TuiThemeCurrent

function colorOf(theme: TuiThemeCurrent, key: ColorKey): RGBA {
  return theme[key] as RGBA
}

export function ProgressBar(props: {
  ratio: Accessor<{ done: number; total: number }>
  failed?: Accessor<number>
  width?: number
  showLabel?: boolean
  fg?: ColorKey
  trackFg?: ColorKey
}) {
  const { theme } = useTheme()
  const width = () => props.width ?? 10
  const showLabel = () => props.showLabel ?? true
  const filled = createMemo(() => {
    const r = props.ratio()
    if (r.total === 0) return 0
    return Math.round((r.done / r.total) * width())
  })
  const fgColor = createMemo<RGBA>(() => {
    const r = props.ratio()
    const failed = props.failed ? props.failed() : 0
    if (failed > 0) return theme.error
    if (r.done >= r.total && r.total > 0) return theme.success
    return colorOf(theme, props.fg ?? "accent")
  })
  const trackColor = () => colorOf(theme, props.trackFg ?? "textMuted")
  const bar = createMemo(() => "█".repeat(filled()) + "░".repeat(width() - filled()))
  const label = createMemo(() => {
    const r = props.ratio()
    return `${r.done}/${r.total}`
  })
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={fgColor()} wrapMode="none">
        [{bar()}]
      </text>
      <Show when={showLabel()}>
        <text fg={fgColor()}> {label()}</text>
      </Show>
    </box>
  )
}

export * as WorkflowProgressBar from "./progress-bar"