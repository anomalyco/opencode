type SessionNode = {
  id: string
  parentID?: string
}

export function firstChild<T extends SessionNode>(sessions: readonly T[], session?: SessionNode) {
  if (!session) return
  return sessions
    .filter((item) => item.parentID === session.id)
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .at(0)
}

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}
