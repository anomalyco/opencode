import { createSignal, createMemo, createEffect, onCleanup, type Accessor } from "solid-js"
import type { Message, Part, SessionStatus } from "@opencode-ai/sdk/v2"
import { createRunningTools, ToolItemView } from "./running-tools.tsx"
import { createLLMStatus, LLMStatusView } from "./running-llm.tsx"

// Re-exports
export { extractToolCommand, type RunningItem } from "./running-utils"
export { ToolItemView } from "./running-tools.tsx"
export { LLMStatusView } from "./running-llm.tsx"

type SyncData = {
  session_status: Record<string, SessionStatus>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
}

export function createRunningState(sessionID: Accessor<string>, data: SyncData) {
  const [tick, setTick] = createSignal(Date.now())
  const [thinkingStartTime, setThinkingStartTime] = createSignal<number | null>(null)

  const sessionStatus = createMemo(() => data.session_status?.[sessionID()] ?? { type: "idle" as const })

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
      if (thinkingStartTime() === null) setThinkingStartTime(Date.now())
    } else {
      setThinkingStartTime(null)
    }
  })

  const tools = createRunningTools(sessionID, data, tick)
  const llmStatus = createLLMStatus(sessionID, data, tick, thinkingStartTime)

  return { tick, tools, llmStatus }
}
