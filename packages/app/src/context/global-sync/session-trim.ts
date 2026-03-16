import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { cmp } from "./utils"
import { SESSION_RECENT_LIMIT, SESSION_RECENT_WINDOW } from "./types"

export function sessionUpdatedAt(session: Session) {
  return session.time.updated ?? session.time.created
}

export function compareSessionRecent(a: Session, b: Session) {
  const aUpdated = sessionUpdatedAt(a)
  const bUpdated = sessionUpdatedAt(b)
  if (aUpdated !== bUpdated) return bUpdated - aUpdated
  return cmp(a.id, b.id)
}

export function takeRecentSessions(sessions: Session[], limit: number, cutoff: number) {
  if (limit <= 0) return [] as Session[]
  const selected: Session[] = []
  const seen = new Set<string>()
  for (const session of sessions) {
    if (!session?.id) continue
    if (seen.has(session.id)) continue
    seen.add(session.id)
    if (sessionUpdatedAt(session) <= cutoff) continue
    const index = selected.findIndex((x) => compareSessionRecent(session, x) < 0)
    if (index === -1) selected.push(session)
    if (index !== -1) selected.splice(index, 0, session)
    if (selected.length > limit) selected.pop()
  }
  return selected
}

export function trimSessions(
  input: Session[],
  options: { limit: number; permission: Record<string, PermissionRequest[]>; now?: number },
) {
  const limit = Math.max(0, options.limit)
  const cutoff = (options.now ?? Date.now()) - SESSION_RECENT_WINDOW
  const all = input
    .filter((s) => !!s?.id)
    .filter((s) => !s.time?.archived)
    .sort((a, b) => cmp(a.id, b.id))
  const byId = new Map(all.map((item) => [item.id, item]))
  const byParent = new Map<string, Session[]>()
  for (const item of all) {
    if (!item.parentID) continue
    const list = byParent.get(item.parentID)
    if (list) {
      list.push(item)
      continue
    }
    byParent.set(item.parentID, [item])
  }
  const roots = all.filter((s) => !s.parentID)
  const children = all.filter((s) => !!s.parentID)
  const base = roots.slice(0, limit)
  const recent = takeRecentSessions(roots.slice(limit), SESSION_RECENT_LIMIT, cutoff)
  const keep = new Set([...base, ...recent].map((item) => item.id))

  const add = (id: string) => {
    if (keep.has(id)) return
    keep.add(id)
  }

  const walk = (id: string) => {
    const list = byParent.get(id)
    if (!list) return
    for (const item of list) {
      if (keep.has(item.id)) continue
      keep.add(item.id)
      walk(item.id)
    }
  }

  for (const item of [...base, ...recent]) {
    walk(item.id)
  }

  for (const item of children) {
    const perms = options.permission[item.id] ?? []
    if (perms.length === 0 && sessionUpdatedAt(item) <= cutoff) continue
    walk(item.id)
    add(item.id)
    let pid = item.parentID
    while (pid) {
      add(pid)
      pid = byId.get(pid)?.parentID
    }
  }

  return all.filter((item) => keep.has(item.id))
}
