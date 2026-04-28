export function isSessionWorking(status?: { type?: string }) {
  return status?.type === "busy" || status?.type === "retry"
}

export function hasSettledLatestAssistantTurn(
  messages: Array<{
    role: string
    error?: unknown
    finish?: string
    time?: { completed?: number; created?: number }
  }>,
) {
  let sawLatestUser = false
  let latestAssistant:
    | {
        error?: unknown
        finish?: string
        time?: { completed?: number; created?: number }
      }
    | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) continue
    if (message.role === "user") {
      sawLatestUser = true
      break
    }
    if (message.role !== "assistant") continue
    if (!latestAssistant) latestAssistant = message
  }

  if (!sawLatestUser || !latestAssistant) return false
  if (latestAssistant.finish === "tool-calls") return false
  if (typeof latestAssistant.time?.completed === "number") return true
  return !!latestAssistant.error
}

export function isSessionActuallyWorking(
  status: { type?: string } | undefined,
  messages: Array<{
    role: string
    error?: unknown
    finish?: string
    time?: { completed?: number; created?: number }
  }>,
) {
  return isSessionWorking(status) && !hasSettledLatestAssistantTurn(messages)
}
