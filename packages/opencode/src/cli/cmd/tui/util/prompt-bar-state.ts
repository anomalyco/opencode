import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2"

export type PromptBarState =
  | "error"
  | "warning"
  | "tool_running"
  | "streaming"
  | "tool_result"
  | "assistant_final"
  | "idle"

export type SessionStatusInfo =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" }

export type PromptBarInput = {
  sessionStatus?: SessionStatusInfo
  messages: Message[]
  partsByMessageId: Record<string, Part[]>
}

export function derivePromptBarState(input: PromptBarInput): PromptBarState {
  const lastAssistantMessage = input.messages.findLast(
    (message): message is AssistantMessage => message.role === "assistant",
  )
  const lastAssistantParts = lastAssistantMessage
    ? input.partsByMessageId[lastAssistantMessage.id] ?? []
    : []
  if (lastAssistantMessage?.error) {
    const errorName = lastAssistantMessage.error.name
    if (errorName !== "MessageAbortedError") {
      return "error"
    }
  }

  if (input.sessionStatus?.type === "retry") {
    return "warning"
  }

  const hasRunningTool = lastAssistantParts.some((p) => {
    if (p.type !== "tool") return false
    return p.state.status === "pending" || p.state.status === "running"
  })
  if (hasRunningTool) {
    return "tool_running"
  }

  const hasToolError = lastAssistantParts.some(
    (p) => p.type === "tool" && p.state.status === "error",
  )
  if (hasToolError) {
    return "warning"
  }

  if (input.sessionStatus?.type === "busy") {
    return "streaming"
  }

  const finish = lastAssistantMessage?.finish
  const isToolCallsFinish = finish === "tool-calls"
  const isFinalFinish = typeof finish === "string" && !["tool-calls", "unknown"].includes(finish)

  const hasCompletedTool = lastAssistantParts.some(
    (p) => p.type === "tool" && p.state.status === "completed",
  )
  if (hasCompletedTool && isToolCallsFinish) {
    return "tool_result"
  }

  if (isFinalFinish) {
    return "assistant_final"
  }

  return "idle"
}
