import { createMemo, Show, type Accessor } from "solid-js"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { formatDuration } from "../../../../util/format"
import { useTheme } from "../context/theme"
import { RUNNING_THRESHOLD_MS, type RunningItem } from "./running-utils"

type LLMData = {
  session_status: Record<string, SessionStatus>
}

const STATUS_LABELS: Record<string, string> = {
  sending: "Sending...",
  planning: "Planning...",
  reasoning: "Reasoning...",
  streaming: "Streaming...",
  busy: "Busy...",
}

export function createLLMStatus(
  sessionID: Accessor<string>,
  data: LLMData,
  tick: Accessor<number>,
  thinkingStartTime: Accessor<number | null>,
): Accessor<RunningItem | null> {
  const sessionStatus = createMemo(() => data.session_status?.[sessionID()] ?? { type: "idle" as const })

  return createMemo((): RunningItem | null => {
    const now = tick()
    const status = sessionStatus()

    if (status.type === "retry") {
      const remaining = Math.max(0, Math.ceil((status.next - now) / 1000))
      return { id: "llm-status", label: `Retrying in ${remaining}s`, startTime: now, suffix: status.message }
    }

    const startTime = thinkingStartTime()
    if (!startTime || now - startTime < RUNNING_THRESHOLD_MS) return null

    const label = STATUS_LABELS[status.type]
    if (label) return { id: "llm-status", label, startTime }

    return null
  })
}

export function LLMStatusView(props: { item: RunningItem; now: number }) {
  const { theme } = useTheme()
  const elapsed = () => {
    if (props.item.startTime === undefined) return ""
    return formatDuration(Math.floor((props.now - props.item.startTime) / 1000))
  }

  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} fg={theme.warning}>
        ●
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.item.label}
        <Show when={elapsed()}>
          <span style={{ fg: theme.textMuted }}> {elapsed()}</span>
        </Show>
        <Show when={props.item.suffix}>
          <span style={{ fg: theme.textMuted }}> ({props.item.suffix})</span>
        </Show>
      </text>
    </box>
  )
}
