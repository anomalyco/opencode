import type { Session } from "@opencode-ai/sdk/v2"

// Walk the in-memory session list and return the root together with every
// transitive subagent under it. Pure function over a session snapshot so callers
// can wrap it in `createMemo` and have it track only what changed.
//
// Returns `[]` when `rootID` is not in `sessions` so the caller can treat an
// unknown root the same as an empty tree without a special case.
export function sessionTree(sessions: readonly Session[], rootID: string): Session[] {
  const byParent = new Map<string, Session[]>()
  let root: Session | undefined
  for (const s of sessions) {
    if (s.id === rootID) root = s
    if (!s.parentID) continue
    const bucket = byParent.get(s.parentID) ?? []
    bucket.push(s)
    byParent.set(s.parentID, bucket)
  }
  if (!root) return []
  const out: Session[] = [root]
  const seen = new Set([rootID])
  // Appending to `queue` while iterating is the BFS frontier; `for...of` over a
  // growing array visits the new entries and avoids shift()'s O(n^2).
  const queue = [rootID]
  for (const id of queue) {
    const kids = byParent.get(id)
    if (!kids) continue
    for (const kid of kids) {
      if (seen.has(kid.id)) continue
      seen.add(kid.id)
      out.push(kid)
      queue.push(kid.id)
    }
  }
  return out
}
