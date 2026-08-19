type SessionRequest = {
  id: string
}

type SessionInfo = {
  id: string
  parentID?: string
}

export function visibleSessionRequests<T extends SessionRequest>(input: {
  routeSessionID: string
  currentSession: SessionInfo | undefined
  sessions: readonly SessionInfo[]
  requests: Record<string, readonly T[] | undefined>
}) {
  const children = input.sessions.reduce<Record<string, string[]>>((acc, session) => {
    if (!session.parentID) return acc
    acc[session.parentID] = [...(acc[session.parentID] ?? []), session.id]
    return acc
  }, {})
  const descendants = (sessionID: string): string[] =>
    (children[sessionID] ?? []).flatMap((childID) => [childID, ...descendants(childID)])
  const parentID = input.currentSession?.parentID ? input.routeSessionID : (input.currentSession?.id ?? input.routeSessionID)
  const sessionIDs = new Set([input.routeSessionID, parentID, ...descendants(parentID)])

  return [...sessionIDs].toSorted().flatMap((sessionID) => input.requests[sessionID] ?? [])
}
