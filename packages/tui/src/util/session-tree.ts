import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"

// Breadth-first collection of `rootID` and every descendant (any depth), reading the
// flat `parentID` lineage. `seen` makes it cycle-safe (session trees are acyclic by
// construction, but the guard costs nothing and removes an infinite-loop foot-gun).
export function collectSubtree(sessions: readonly Session[], rootID: string): string[] {
  const ids = [rootID]
  const seen = new Set([rootID])
  const queue = [rootID]
  while (queue.length > 0) {
    const parentID = queue.pop()!
    for (const s of sessions) {
      if (s.parentID !== parentID) continue
      if (seen.has(s.id)) continue
      seen.add(s.id)
      ids.push(s.id)
      queue.push(s.id)
    }
  }
  return ids
}

export function isActiveSessionStatus(status: SessionStatus | undefined): boolean {
  return status !== undefined && status.type !== "idle"
}

export function countActiveDescendants(
  sessions: readonly Session[],
  status: Readonly<Record<string, SessionStatus | undefined>> | undefined,
  currentID: string,
): number {
  return collectSubtree(sessions, currentID).filter((id) => {
    if (id === currentID) return false
    return isActiveSessionStatus(status?.[id])
  }).length
}
