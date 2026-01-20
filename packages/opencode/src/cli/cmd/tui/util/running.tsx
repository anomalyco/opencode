import { createSignal, createMemo, createEffect, onCleanup, Show, type Accessor } from "solid-js"
import type { Message, Part, SessionStatus, ToolPart, TextPart, ReasoningPart } from "@opencode-ai/sdk/v2"
import { formatDuration } from "../../../../util/format"
import { useTheme } from "../context/theme"
import { extractToolCommand, RUNNING_THRESHOLD_MS, type RunningItem } from "./running-utils"

// Re-export for convenience
export type { RunningItem } from "./running-utils"
export { extractToolCommand } from "./running-utils"

type SyncData = {
  session_status: Record<string, SessionStatus>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
}

export function RunningItemView(props: { item: RunningItem; now: number }) {
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

export function createRunningState(sessionID: Accessor<string>, data: SyncData) {
  const [tick, setTick] = createSignal(Date.now())

  const sessionStatus = createMemo(() => data.session_status?.[sessionID()] ?? { type: "idle" as const })
  const messages = createMemo(() => data.message[sessionID()] ?? [])

  const [thinkingStartTime, setThinkingStartTime] = createSignal<number | null>(null)

  // Only tick when session is busy or retrying
  createEffect(() => {
    const status = sessionStatus()
    if (status.type === "busy" || status.type === "retry") {
      const interval = setInterval(() => setTick(Date.now()), 1000)
      onCleanup(() => clearInterval(interval))
    }
  })

  // Track when thinking started
  createEffect(() => {
    const status = sessionStatus()
    if (status.type === "busy") {
      if (thinkingStartTime() === null) {
        setThinkingStartTime(Date.now())
      }
    } else {
      setThinkingStartTime(null)
    }
  })

  const runningTools = createMemo(() => {
    const now = tick()
    const tools: { id: string; tool: string; input: Record<string, unknown>; startTime: number }[] = []

    for (const message of messages()) {
      const parts = data.part[message.id] ?? []
      for (const part of parts) {
        if (part.type === "tool") {
          const toolPart = part as ToolPart
          if (toolPart.state.status === "running") {
            const startTime = toolPart.state.time.start
            if (now - startTime >= RUNNING_THRESHOLD_MS) {
              tools.push({
                id: toolPart.id,
                tool: toolPart.tool,
                input: toolPart.state.input,
                startTime,
              })
            }
          }
        }
      }
    }

    return tools.sort((a, b) => a.startTime - b.startTime)
  })

  const inferenceStatus = createMemo((): RunningItem | null => {
    const now = tick()
    const status = sessionStatus()

    // Handle retry state
    if (status.type === "retry") {
      const remaining = Math.max(0, Math.ceil((status.next - now) / 1000))
      return {
        id: "inference",
        label: `Retrying in ${remaining}s`,
        startTime: now,
        suffix: status.message,
      }
    }

    // Not busy = no inference happening
    if (status.type !== "busy") return null

    // Check threshold
    const startTime = thinkingStartTime()
    if (!startTime || now - startTime < RUNNING_THRESHOLD_MS) return null

    const sessionMessages = messages()
    const lastMsg = sessionMessages.at(-1)

    // No messages or last is user message = sending request
    if (!lastMsg || lastMsg.role === "user") {
      return { id: "inference", label: "Sending...", startTime }
    }

    // Have assistant message - check parts
    const parts = data.part[lastMsg.id] ?? []

    // No parts yet = pondering (waiting for first token)
    if (parts.length === 0) {
      return { id: "inference", label: "Pondering...", startTime }
    }

    // Check for active text/reasoning streaming (ignore tool parts)
    const lastTextOrReasoning = [...parts]
      .reverse()
      .find((p): p is TextPart | ReasoningPart => p.type === "text" || p.type === "reasoning")

    if (lastTextOrReasoning) {
      const hasContent = lastTextOrReasoning.text?.length > 0
      const isComplete = lastTextOrReasoning.time?.end !== undefined

      if (!hasContent) {
        return { id: "inference", label: "Pondering...", startTime }
      }

      if (!isComplete) {
        const streamStartTime = lastTextOrReasoning.time?.start ?? startTime
        return { id: "inference", label: "Streaming...", startTime: streamStartTime }
      }
    }

    // Between tool calls or other intermediate state = pondering
    if (!lastMsg.time.completed) {
      return { id: "inference", label: "Pondering...", startTime }
    }

    return null
  })

  const runningItems = createMemo((): RunningItem[] => {
    const items: RunningItem[] = []

    // Add inference status first (always on top)
    const inference = inferenceStatus()
    if (inference) {
      items.push(inference)
    }

    // Add running tools with agent numbering
    const tools = runningTools()
    let agentIndex = 0
    for (const tool of tools) {
      let label: string
      if (tool.tool === "task") {
        agentIndex++
        const desc = (tool.input.description as string) || "..."
        label = `agent${agentIndex}: ${desc}`
      } else {
        label = extractToolCommand(tool.tool, tool.input)
      }
      items.push({
        id: tool.id,
        label,
        startTime: tool.startTime,
      })
    }

    return items
  })

  return { tick, runningItems }
}
