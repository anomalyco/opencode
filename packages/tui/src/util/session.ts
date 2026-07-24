import type { Session } from "@opencode-ai/sdk/v2"

export function isDefaultTitle(title: string) {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

export function sessionFamily(sessions: readonly Session[], rootID: string) {
  const root = sessions.find((session) => session.id === rootID)
  if (!root) return []

  const children = sessions.reduce((result, session) => {
    if (!session.parentID) return result
    const existing = result.get(session.parentID)
    if (existing) {
      existing.push(session)
      return result
    }
    result.set(session.parentID, [session])
    return result
  }, new Map<string, Session[]>())

  const collect = (parentID: string, ancestors: ReadonlySet<string>): Session[] =>
    (children.get(parentID) ?? []).flatMap((session) => {
      if (ancestors.has(session.id)) return []
      const lineage = new Set(ancestors).add(session.id)
      return [session, ...collect(session.id, lineage)]
    })

  return [root, ...collect(root.id, new Set([root.id]))]
}
