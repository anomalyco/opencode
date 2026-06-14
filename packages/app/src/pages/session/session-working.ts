import type { AssistantMessage, Message, SessionStatus } from "@opencode-ai/sdk/v2/client"

const idle = { type: "idle" as const }

export function pending(list: readonly Message[] | undefined) {
  const last = list?.at(-1)
  if (!last || last.role !== "assistant") return false
  return typeof last.time.completed !== "number"
}

export function active(list: readonly Message[] | undefined): AssistantMessage | undefined {
  const last = list?.at(-1)
  if (!last || last.role !== "assistant") return
  if (typeof last.time.completed === "number") return
  return last
}

export function working(status: SessionStatus | undefined, list: readonly Message[] | undefined) {
  if ((status ?? idle).type === "idle") return active(list) !== undefined
  const last = list?.at(-1)
  if (!last || last.role !== "assistant") return true
  if (typeof last.time.completed !== "number") return true
  return active(list) !== undefined
}
