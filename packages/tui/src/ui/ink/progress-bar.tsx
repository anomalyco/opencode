import { createMemo } from "solid-js"
import { useTheme } from "../../context/theme"

export function InkProgressBar(props: {
  value: number
  total?: number
  label?: string
  width?: number
}) {
  const { theme } = useTheme()
  const pct = createMemo(() => {
    const total = props.total ?? 100
    return Math.max(0, Math.min(100, total === 0 ? 0 : (props.value / total) * 100))
  })
  const barWidth = () => (props.width ?? 30) - 2
  const filled = () => Math.round((pct() / 100) * barWidth())
  const empty = () => barWidth() - filled()
  const pctLabel = () => `${Math.round(pct())}%`

  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      <text fg={theme.textMuted}>{"["}</text>
      <text fg={theme.accent}>{"█".repeat(filled())}</text>
      <text fg={theme.border}>{"░".repeat(empty())}</text>
      <text fg={theme.textMuted}>{"]"}</text>
      <text fg={theme.text}>
        <b>{pctLabel()}</b>
      </text>
      <text fg={theme.textMuted}>{props.label ?? ""}</text>
    </box>
  )
}
