import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"

const MIN_BAR_WIDTH = 6
const WARNING_DISTANCE = 5
const NEAR_FULL_PERCENT = 90

export type ContextCountdownProps = {
  used: number
  window: number
  threshold?: number
  width: number
}

export function ContextCountdown(props: ContextCountdownProps) {
  const { theme } = useTheme()
  const percent = createMemo(() => clampPercent(Math.round((props.used / props.window) * 100)))
  const thresholdPercent = createMemo(() => {
    if (props.threshold === undefined) return
    return clampPercent(Math.round((props.threshold / props.window) * 100))
  })
  const label = createMemo(() => {
    const threshold = thresholdPercent()
    if (threshold === undefined) return `Context ${percent()}%`
    return `Context ${percent()}% · auto-compact ~${threshold}%`
  })
  const barWidth = createMemo(() => Math.max(0, Math.floor(props.width)))
  const fillWidth = createMemo(() => Math.min(barWidth(), Math.max(0, Math.round((barWidth() * percent()) / 100))))
  const trackWidth = createMemo(() => Math.max(0, barWidth() - fillWidth()))
  const fillColor = createMemo(() => {
    const threshold = thresholdPercent()
    if (threshold !== undefined) return percent() >= Math.max(0, threshold - WARNING_DISTANCE) ? theme.warning : theme.accent
    return percent() >= NEAR_FULL_PERCENT ? theme.warning : theme.accent
  })

  return (
    <Show when={props.window > 0}>
      <box gap={0}>
        <text fg={theme.textMuted} wrapMode="none">
          {label()}
        </text>
        <Show when={barWidth() >= MIN_BAR_WIDTH}>
          <text wrapMode="none" width={barWidth()}>
            <span style={{ fg: fillColor() }}>{"━".repeat(fillWidth())}</span>
            <span style={{ fg: theme.textMuted }}>{"─".repeat(trackWidth())}</span>
          </text>
        </Show>
      </box>
    </Show>
  )
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value))
}
