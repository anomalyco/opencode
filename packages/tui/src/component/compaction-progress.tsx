import { createMemo, Show } from "solid-js"
import { useKV } from "../context/kv"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"

const DEFAULT_LABEL = "Compacting conversation..."
const MIN_BAR_WIDTH = 6
const MAX_SEGMENT_WIDTH = 8

export type CompactionProgressProps = {
  active: boolean
  elapsedSeconds: number
  width: number
  label?: string
}

export function CompactionProgress(props: CompactionProgressProps) {
  const { theme } = useTheme()
  const kv = useKV()
  const animationsEnabled = () => kv.get("animations_enabled", true)
  const elapsed = createMemo(() => `${Math.max(0, Math.floor(props.elapsedSeconds))}s`)
  const barWidth = createMemo(() => Math.max(0, Math.floor(props.width)))
  const segmentWidth = createMemo(() => Math.min(MAX_SEGMENT_WIDTH, Math.max(1, Math.floor(barWidth() / 3))))
  const segmentStart = createMemo(() => {
    if (!animationsEnabled()) return 0
    return Math.max(0, Math.floor(props.elapsedSeconds)) % Math.max(1, barWidth() - segmentWidth() + 1)
  })
  const bar = createMemo(() => ({
    before: "─".repeat(segmentStart()),
    segment: "━".repeat(segmentWidth()),
    after: "─".repeat(Math.max(0, barWidth() - segmentStart() - segmentWidth())),
  }))

  return (
    <Show when={props.active}>
      <box gap={0}>
        <box flexDirection="row" gap={1}>
          <Spinner color={theme.accent}>
            <span style={{ fg: theme.textMuted }}>{props.label ?? DEFAULT_LABEL}</span>
          </Spinner>
          <text fg={theme.textMuted} wrapMode="none">
            {elapsed()}
          </text>
        </box>
        <Show when={barWidth() >= MIN_BAR_WIDTH}>
          <text wrapMode="none" width={barWidth()}>
            <span style={{ fg: theme.textMuted }}>{bar().before}</span>
            <span style={{ fg: theme.accent }}>{bar().segment}</span>
            <span style={{ fg: theme.textMuted }}>{bar().after}</span>
          </text>
        </Show>
      </box>
    </Show>
  )
}
