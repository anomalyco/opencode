import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2"

export function sessionChildren(list: Session[], current?: Session) {
  const id = current?.parentID ?? current?.id
  if (!id) return []
  return list
    .filter((item) => item.parentID === id || item.id === id)
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function sessionTreeRequest<T>(
  sessions: Session[],
  requests: Record<string, T[] | undefined>,
  current?: Session,
  include: (item: T) => boolean = () => true,
) {
  const id = current?.parentID ?? current?.id
  if (!id) return

  const map = sessions.reduce((acc, item) => {
    if (!item.parentID) return acc
    const list = acc.get(item.parentID)
    if (list) list.push(item.id)
    if (!list) acc.set(item.parentID, [item.id])
    return acc
  }, new Map<string, string[]>())

  // Breadth-first traversal so root requests are preferred over descendants.
  const seen = new Set([id])
  const ids = [id]
  for (const item of ids) {
    const list = map.get(item)
    if (!list) continue
    for (const child of list) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  const hit = ids.find((item) => requests[item]?.some(include))
  if (!hit) return
  return requests[hit]?.find(include)
}

export function sessionPermissionRequest(
  session: Session[],
  request: Record<string, PermissionRequest[] | undefined>,
  current?: Session,
  include?: (item: PermissionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, current, include)
}

export function sessionQuestionRequest(
  session: Session[],
  request: Record<string, QuestionRequest[] | undefined>,
  current?: Session,
  include?: (item: QuestionRequest) => boolean,
) {
  return sessionTreeRequest(session, request, current, include)
}
