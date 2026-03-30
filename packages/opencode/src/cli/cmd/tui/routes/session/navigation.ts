type SessionNode = {
  id: string
  parentID?: string | null
}

function byID(a: SessionNode, b: SessionNode) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function getDirectChildSessions<T extends SessionNode>(sessions: readonly T[], sessionID?: string): T[] {
  if (!sessionID) return []
  return sessions.filter((session) => session.parentID === sessionID).toSorted(byID)
}

export function getSiblingSessions<T extends SessionNode>(sessions: readonly T[], session?: T): T[] {
  if (!session?.parentID) return []
  return sessions.filter((candidate) => candidate.parentID === session.parentID).toSorted(byID)
}

export function shouldRenderSessionPrompt(input: {
  session?: SessionNode
  permissionCount: number
  questionCount: number
}) {
  return !input.session?.parentID && input.permissionCount === 0 && input.questionCount === 0
}
