export type OpenCodeEvent = {
  type: string
  properties?: Record<string, unknown>
}

export type MonitorEventType = "complete" | "permission" | "error"

export function extractSessionID(event: OpenCodeEvent): string | null {
  const props = event.properties ?? {}

  const fromDirect = props.sessionID
  if (typeof fromDirect === "string" && fromDirect.length > 0) return fromDirect

  const info = props.info
  if (info && typeof info === "object") {
    const infoSessionID = (info as Record<string, unknown>).sessionID
    if (typeof infoSessionID === "string" && infoSessionID.length > 0) return infoSessionID
  }

  const part = props.part
  if (part && typeof part === "object") {
    const partSessionID = (part as Record<string, unknown>).sessionID
    if (typeof partSessionID === "string" && partSessionID.length > 0) return partSessionID
  }

  return null
}

export function classifyMonitorEvent(event: OpenCodeEvent): MonitorEventType | null {
  const type = event.type
  const lowerType = type.toLowerCase()

  if (lowerType === "permission.asked" || lowerType === "permission") {
    return "permission"
  }

  if (lowerType.includes("error")) {
    return "error"
  }

  if (type === "session.status") {
    const status = event.properties?.status
    if (status && typeof status === "object") {
      const statusType = (status as Record<string, unknown>).type
      if (statusType === "idle") {
        return "complete"
      }
    }
  }

  return null
}

export function formatMonitorEventLabel(eventType: MonitorEventType): string {
  switch (eventType) {
    case "complete":
      return "Session complete"
    case "permission":
      return "Action needed"
    case "error":
      return "Session error"
    default:
      return "Session update"
  }
}
