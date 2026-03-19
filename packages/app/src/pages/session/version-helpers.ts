import type { Session as SDKSession } from "@opencode-ai/sdk/v2/client"

type SessionVersion = Pick<SDKSession, "id" | "title" | "parentID" | "time" | "lineage">

const sameVersion = (a: SessionVersion | undefined, b: SessionVersion | undefined) => {
  if (a === b) return true
  if (!a || !b) return false
  if (a.id !== b.id) return false
  if (a.title !== b.title) return false
  if (a.parentID !== b.parentID) return false
  if (a.time.created !== b.time.created) return false
  if (a.time.updated !== b.time.updated) return false
  if (a.lineage?.number !== b.lineage?.number) return false
  if (a.lineage?.latestID !== b.lineage?.latestID) return false
  if (a.lineage?.rootID !== b.lineage?.rootID) return false
  return true
}

export function sameVersionItems(a: readonly SessionVersion[], b: readonly SessionVersion[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((item, index) => sameVersion(item, b[index]))
}

export function hasSessionChanges(current: readonly SessionVersion[], next: readonly SessionVersion[]) {
  const seen = new Map(current.map((item) => [item.id, item]))
  return next.some((item) => !sameVersion(seen.get(item.id), item))
}
