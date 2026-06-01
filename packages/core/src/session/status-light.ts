export type StatusLightColor = "green" | "yellow" | "red"

export function computeStatusLight(input: {
  enabled: boolean
  sessionStatus?: { type: string }
  messages?: readonly { role: string; id: string }[]
  pendingInput: boolean
  parts?: readonly { type: string; state?: { status?: string }; synthetic?: boolean; ignored?: boolean }[]
}): StatusLightColor | null {
  if (!input.enabled) return null
  if (!input.sessionStatus || input.sessionStatus.type === "idle") return "green"
  if (!input.messages) return "green"
  if (input.pendingInput) return "green"
  const lastAssistant = input.messages.findLast((m) => m.role === "assistant")
  if (!lastAssistant) return "yellow"
  if (!input.parts) return "yellow"
  if (
    input.parts.some(
      (p) => p.type === "tool" && (p.state?.status === "running" || p.state?.status === "pending"),
    )
  )
    return "red"
  if (input.parts.some((p) => p.type === "text" && !p.synthetic && !p.ignored)) return "red"
  return "yellow"
}

export * as StatusLight from "./status-light"
