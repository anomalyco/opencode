export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

// Cost of a session plus all of its descendant (subagent) sessions.
export function totalCost(sessions: readonly { id: string; parentID?: string; cost?: number }[], sessionID: string) {
  const seen = new Set<string>()
  const walk = (id: string): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    return sessions
      .filter((item) => item.parentID === id)
      .reduce((sum, item) => sum + walk(item.id), sessions.find((item) => item.id === id)?.cost ?? 0)
  }
  return walk(sessionID)
}
