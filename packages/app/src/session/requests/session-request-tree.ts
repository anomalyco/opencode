import type { SessionID } from "@opencode/schema/session-id"
import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client/promise"

function sessionTreeRequest<T>(
  session: SessionInfo[],
  request: Record<string, T[] | undefined> | ((sessionID: SessionID) => T[] | undefined),
  sessionID?: SessionID,
  include: (item: T) => boolean = () => true,
) {
  const ids = sessionTreeIDs(session, sessionID)
  if (!ids.length) return
  const list = (id: SessionID) => (typeof request === "function" ? request(id) : request[id])
  const id = ids.find((id) => list(id)?.some(include))
  if (!id) return
  return list(id)?.find(include)
}

export function sessionTreeIDs(session: SessionInfo[], sessionID?: SessionID) {
  if (!sessionID) return []
  const map = session.reduce((acc, item) => {
    if (!item.parentID) return acc
    const list = acc.get(item.parentID)
    if (list) list.push(item.id)
    if (!list) acc.set(item.parentID, [item.id])
    return acc
  }, new Map<SessionID, SessionID[]>())

  const seen = new Set([sessionID])
  const ids = [sessionID]
  for (const id of ids) {
    const list = map.get(id)
    if (!list) continue
    for (const child of list) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }
  return ids
}

export function sessionPermissionRequest(
  session: SessionInfo[],
  request:
    | Record<string, PermissionRequest[] | undefined>
    | ((sessionID: SessionID) => PermissionRequest[] | undefined),
  sessionID?: SessionID,
  include?: (item: PermissionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, sessionID, include)
}

export function sessionFormRequest(
  session: SessionInfo[],
  request: Record<string, FormInfo[] | undefined> | ((sessionID: SessionID) => FormInfo[] | undefined),
  sessionID?: SessionID,
) {
  return sessionTreeRequest(
    session,
    request,
    sessionID,
    (item) => item.metadata?.kind === "question" || item.metadata?.kind === "websearch.provider",
  )
}
