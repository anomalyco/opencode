import { createSignal, createMemo, createEffect, onCleanup, type Accessor } from "solid-js"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { createRunningTools, ToolItemView } from "./running-tools.tsx"
import { createLLMStatus, LLMStatusView } from "./running-llm.tsx"

// Re-exports
export { extractToolCommand, type RunningItem } from "./running-utils"
export { ToolItemView } from "./running-tools.tsx"
export { LLMStatusView } from "./running-llm.tsx"

type SyncData = {
  session: Session[]
  session_status: Record<string, SessionStatus>
  message: Record<string, Message[]>
  part: Record<string, Part[]>
}

const ACTIVE_STATUSES = new Set(["sending", "planning", "reasoning", "streaming", "busy", "retry"])

function isActive(status: SessionStatus): boolean {
  return ACTIVE_STATUSES.has(status.type)
}

export function createRunningState(sessionID: Accessor<string>, data: SyncData) {
  const [tick, setTick] = createSignal(Date.now())
  const [thinkingStartTime, setThinkingStartTime] = createSignal<number | null>(null)

  const sessionStatus = createMemo(() => data.session_status?.[sessionID()] ?? { type: "idle" as const })

  // Only tick when session is active
  createEffect(() => {
    if (isActive(sessionStatus())) {
      const interval = setInterval(() => setTick(Date.now()), 1000)
      onCleanup(() => clearInterval(interval))
    }
  })

  // Track when activity started
  createEffect(() => {
    if (isActive(sessionStatus())) {
      if (thinkingStartTime() === null) setThinkingStartTime(Date.now())
    } else {
      setThinkingStartTime(null)
    }
  })

  const tools = createRunningTools(sessionID, data, tick)
  const llmStatus = createLLMStatus(sessionID, data, tick, thinkingStartTime)

  return { tick, tools, llmStatus }
}
