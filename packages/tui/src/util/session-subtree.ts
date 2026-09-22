import type { Session } from "@opencode-ai/sdk/v2"

/**
 * Cost of `sessionID` split into its own spend and the recursive spend of all
 * descendant subagent sessions. The visited set guards against `parentID`
 * cycles in hand-edited data.
 */
export function subtreeCost(sessions: ReadonlyArray<Session>, sessionID: string): { self: number; subagents: number } {
  const byParent = new Map<string, Session[]>()
  for (const session of sessions) {
    if (session.parentID === undefined) continue
    byParent.set(session.parentID, [...(byParent.get(session.parentID) ?? []), session])
  }
  const visited = new Set<string>([sessionID])
  let subagents = 0
  const walk = (parentID: string) => {
    for (const child of byParent.get(parentID) ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      subagents += child.cost ?? 0
      walk(child.id)
    }
  }
  walk(sessionID)
  return { self: sessions.find((session) => session.id === sessionID)?.cost ?? 0, subagents }
}