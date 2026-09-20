import type { NativeRecord } from "./native-types"

export type AgentTree = {
  rootSessionID?: string
  nodes: NativeRecord[]
  complete: boolean
  missingParentID?: string
}

export function projectAgentTree(selectedSessionID: string, sessions: NativeRecord[]): AgentTree {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const resolution = resolveRoot(selectedSessionID, byID)
  if (!resolution.rootSessionID) {
    return { nodes: descendants(selectedSessionID, byID), complete: false, missingParentID: resolution.missingParentID }
  }
  const nodes = descendants(resolution.rootSessionID, byID)
  const complete =
    nodes.length === byID.size && nodes.every((node) => node.error === undefined && node.status !== "unknown")
  return { rootSessionID: resolution.rootSessionID, nodes, complete }
}

type RootResolution = { rootSessionID?: string; missingParentID?: string }

function resolveRoot(selectedSessionID: string, byID: Map<string, NativeRecord>): RootResolution {
  const seen = new Set([selectedSessionID])
  let current = selectedSessionID
  while (true) {
    const record = byID.get(current)
    if (!record || record.error) return { missingParentID: current }
    if (!record.parentID) return { rootSessionID: current }
    if (seen.has(record.parentID)) return {}
    seen.add(record.parentID)
    current = record.parentID
  }
}

function descendants(rootSessionID: string, byID: Map<string, NativeRecord>) {
  const children = new Map<string, string[]>()
  for (const session of byID.values()) {
    if (!session.parentID) continue
    const list = children.get(session.parentID)
    if (list) list.push(session.id)
    if (!list) children.set(session.parentID, [session.id])
  }

  const seen = new Set([rootSessionID])
  const ids = [rootSessionID]
  for (const id of ids) {
    const list = children.get(id)
    if (!list) continue
    for (const child of list) {
      if (seen.has(child)) continue
      seen.add(child)
      ids.push(child)
    }
  }

  return ids.flatMap((id) => {
    const record = byID.get(id)
    return record ? [record] : []
  })
}
