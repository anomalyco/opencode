import { createMemo, Show, type Accessor } from "solid-js"
import type { Message, Part, SessionStatus, TextPart, ReasoningPart } from "@opencode-ai/sdk/v2"
import { formatDuration } from "../../../../util/format"
import { useTheme } from "../context/theme"
import { RUNNING_THRESHOLD_MS, type RunningItem } from "./running-utils"

type LLMData = {
  session_status: Record<string, SessionStatus>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
}

export function createLLMStatus(
  sessionID: Accessor<string>,
  data: LLMData,
  tick: Accessor<number>,
  thinkingStartTime: Accessor<number | null>,
): Accessor<RunningItem | null> {
  const sessionStatus = createMemo(() => data.session_status?.[sessionID()] ?? { type: "idle" as const })
  const messages = createMemo(() => data.message[sessionID()] ?? [])

  return createMemo((): RunningItem | null => {
    const now = tick()
    const status = sessionStatus()

    // Handle retry state
    if (status.type === "retry") {
      const remaining = Math.max(0, Math.ceil((status.next - now) / 1000))
      return {
        id: "llm-status",
        label: `Retrying in ${remaining}s`,
        startTime: now,
        suffix: status.message,
      }
    }

    if (status.type !== "busy") return null

    const startTime = thinkingStartTime()
    if (!startTime || now - startTime < RUNNING_THRESHOLD_MS) return null

    const lastMsg = messages().at(-1)
    if (!lastMsg || lastMsg.role === "user") {
      return { id: "llm-status", label: "Sending...", startTime }
    }

    const parts = data.part[lastMsg.id] ?? []
    if (parts.length === 0) {
      return { id: "llm-status", label: "Pondering...", startTime }
    }

    const lastTextOrReasoning = [...parts]
      .reverse()
      .find((p): p is TextPart | ReasoningPart => p.type === "text" || p.type === "reasoning")

    if (lastTextOrReasoning) {
      const hasContent = lastTextOrReasoning.text?.length > 0
      const isComplete = lastTextOrReasoning.time?.end !== undefined

      if (!hasContent) return { id: "llm-status", label: "Pondering...", startTime }
      if (!isComplete) {
        const streamStartTime = lastTextOrReasoning.time?.start ?? startTime
        return { id: "llm-status", label: "Streaming...", startTime: streamStartTime }
      }
    }

    if (!lastMsg.time.completed) {
      return { id: "llm-status", label: "Pondering...", startTime }
    }

    return null
  })
}

export function LLMStatusView(props: { item: RunningItem; now: number }) {
  const { theme } = useTheme()
  const elapsed = () => formatDuration(Math.floor((props.now - props.item.startTime) / 1000))

  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} fg={theme.warning}>
        ●
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.item.label}
        <span style={{ fg: theme.textMuted }}> {elapsed()}</span>
        <Show when={props.item.suffix}>
          <span style={{ fg: theme.textMuted }}> ({props.item.suffix})</span>
        </Show>
      </text>
    </box>
  )
}
