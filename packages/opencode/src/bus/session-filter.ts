/**
 * Extract a sessionID from a bus event payload for SSE filtering.
 *
 * Returns `undefined` when the event carries no session affinity
 * (e.g. server.*, lsp.*, config.*, mcp.*, project.*).
 */
export function extractSessionID(payload: {
  type: string
  properties: Record<string, unknown> | undefined
}): string | undefined {
  const props = payload.properties
  if (!props) return undefined

  // Direct sessionID on properties (most session/message events)
  if (typeof props.sessionID === "string") return props.sessionID

  // session.created / session.updated / session.deleted → properties.info.id
  const info = props.info
  if (
    info &&
    typeof info === "object" &&
    "id" in info &&
    typeof (info as Record<string, unknown>).id === "string" &&
    payload.type.startsWith("session.")
  )
    return (info as Record<string, unknown>).id as string

  // message.updated → properties.info.sessionID
  if (
    info &&
    typeof info === "object" &&
    "sessionID" in info &&
    typeof (info as Record<string, unknown>).sessionID === "string"
  )
    return (info as Record<string, unknown>).sessionID as string

  // message.part.updated → properties.part.sessionID
  const part = props.part
  if (
    part &&
    typeof part === "object" &&
    "sessionID" in part &&
    typeof (part as Record<string, unknown>).sessionID === "string"
  )
    return (part as Record<string, unknown>).sessionID as string

  return undefined
}
