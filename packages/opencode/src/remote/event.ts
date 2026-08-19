const forwardedTypes = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.error",
  "session.status",
  "session.idle",
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.removed",
  "message.part.delta",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
])

type EventData = {
  id: string
  type: string
  data: unknown
}

function belongsToSession(value: unknown, sessionID: string) {
  if (!value || typeof value !== "object") return false
  const data = value as Record<string, unknown>
  if (data.sessionID === sessionID) return true
  for (const key of ["info", "part", "message"]) {
    const nested = data[key]
    if (nested && typeof nested === "object" && (nested as Record<string, unknown>).sessionID === sessionID) return true
  }
  return false
}

export function shouldForward(event: Pick<EventData, "type" | "data">, sessionID: string) {
  return forwardedTypes.has(event.type) && belongsToSession(event.data, sessionID)
}

export function signal(event: Pick<EventData, "id" | "type">) {
  return { id: event.id, type: event.type, properties: {} }
}

export * as RemoteEvent from "./event"
