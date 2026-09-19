export function sessionRemovalIDs(sessions: ReadonlyArray<{ id: string; parentID?: string }>, sessionID: string) {
  const removed = new Set([sessionID])
  const children = new Map<string, string[]>()
  sessions.forEach((session) => {
    if (!session.parentID) return
    const list = children.get(session.parentID)
    if (list) list.push(session.id)
    else children.set(session.parentID, [session.id])
  })
  const pending = [sessionID]
  while (pending.length) {
    const parentID = pending.pop()
    if (!parentID) continue
    children.get(parentID)?.forEach((id) => {
      if (removed.has(id)) return
      removed.add(id)
      pending.push(id)
    })
  }
  return removed
}
