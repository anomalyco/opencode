import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client/promise"
import type { Data } from "@opencode/client/solid"

function sessionTreeRequest<T>(
  session: SessionInfo[],
  request: Record<string, T[] | undefined> | ((sessionID: string) => T[] | undefined),
  sessionID?: string,
  include: (item: T) => boolean = () => true,
) {
  const ids = sessionTreeIDs(session, sessionID)

  if (!ids.length) return
  const list = (id: string) => (request instanceof Function ? request(id) : request[id])
  const id = ids.find((id) => list(id)?.some(include))

  if (!id) return

  return list(id)?.find(include)
}

/**
 * The records of a session's family: its root and every known session below that root. Reading them tracks those
 * sessions only, so a change to any other session, however many the server has, reruns nothing that reads this.
 */
export function sessionFamily(
  data: { session: { family: (sessionID: string) => readonly string[]; get: (sessionID: string) => SessionInfo | undefined } },
  sessionID: string | undefined,
) {
  if (!sessionID) return []

  return [...new Set([sessionID, ...data.session.family(sessionID)])].flatMap((id) => data.session.get(id) ?? [])
}

export function sessionTreeIDs(session: SessionInfo[], sessionID?: string) {
  if (!sessionID) return []

  const map = session.reduce((acc, item) => {
    if (!item.parentID) return acc
    const list = acc.get(item.parentID)

    if (list) list.push(item.id)

    if (!list) acc.set(item.parentID, [item.id])

    return acc
  }, new Map<string, string[]>())

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

// Only a running Session can hold a pending permission or form, and events keep loaded requests current, so idle
// subagents are never read. One that still has cached requests is read too, so a reconnect clears requests answered
// while the client was offline.
export function sessionMayHoldRequests(data: Data, sessionID: string) {
  return (
    data.session.status(sessionID) === "running" ||
    !!data.session.permission.list(sessionID)?.length ||
    !!data.session.form.list(sessionID)?.length
  )
}

export function sessionPermissionRequest(
  session: SessionInfo[],
  request: Record<string, PermissionRequest[] | undefined> | ((sessionID: string) => PermissionRequest[] | undefined),
  sessionID?: string,
  include?: (item: PermissionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, sessionID, include)
}

export function sessionFormRequest(
  session: SessionInfo[],
  request: Record<string, FormInfo[] | undefined> | ((sessionID: string) => FormInfo[] | undefined),
  sessionID?: string,
) {
  return sessionTreeRequest(
    session,
    request,
    sessionID,
    (item) =>
      item.metadata?.kind === "question" ||
      item.metadata?.kind === "websearch.provider" ||
      item.metadata?.kind === "mcp-elicitation",
  )
}
