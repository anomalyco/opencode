export function timelineChildTitle(input: {
  parentID?: string
  taskDescription?: string
  title?: string
  fallback: string
}) {
  if (!input.parentID) return input.title ?? ""
  if (input.taskDescription) return input.taskDescription
  return input.title?.replace(/\s+\(@[^)]+ subagent\)$/, "") || input.fallback
}

export function timelineRemovedSessionIDs(sessions: readonly { id: string; parentID?: string }[], sessionID: string) {
  const removed = new Set([sessionID])
  const byParent = Map.groupBy(
    sessions.filter((session) => session.parentID),
    (session) => session.parentID!,
  )
  const visit = (id: string) =>
    byParent.get(id)?.forEach((child) => {
      if (removed.has(child.id)) return
      removed.add(child.id)
      visit(child.id)
    })
  visit(sessionID)
  return removed
}
