type SessionNavigationItem = {
  id: string
  parentID?: string
}

function sortByID<T extends SessionNavigationItem>(a: T, b: T) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function getCurrentSessionWithChildren<T extends SessionNavigationItem>(
  sessions: readonly T[],
  currentSessionID: string | undefined,
) {
  if (!currentSessionID) return []

  return sessions
    .filter((session) => session.id === currentSessionID || session.parentID === currentSessionID)
    .toSorted(sortByID)
}

export function getFirstDirectChildSession<T extends SessionNavigationItem>(
  sessions: readonly T[],
  currentSessionID: string | undefined,
) {
  if (!currentSessionID) return undefined

  return sessions.filter((session) => session.parentID === currentSessionID).toSorted(sortByID)[0]
}

export function getSiblingSessions<T extends SessionNavigationItem>(
  sessions: readonly T[],
  currentSession: T | undefined,
) {
  if (!currentSession?.parentID) return []

  return sessions.filter((session) => session.parentID === currentSession.parentID).toSorted(sortByID)
}
