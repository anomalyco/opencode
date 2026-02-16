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
  const deduped = new Map<string, Session>()

  for (const session of input) {
    if (!session?.id) continue
    if (session.time?.archived) continue
    const existing = deduped.get(session.id)
    if (!existing) {
      deduped.set(session.id, session)
      continue
    }
    if (compareSessionRecent(session, existing) < 0) {
      deduped.set(session.id, session)
    }
  }

  const sortedByRecent = [...deduped.values()].sort(compareSessionRecent)
  const base = sortedByRecent.slice(0, limit)
  const recent = takeRecentSessions(sortedByRecent.slice(limit), SESSION_RECENT_LIMIT, cutoff)
  const keep = [...base, ...recent]
  const keepIds = new Set(keep.map((session) => session.id))
  const keepPermission = sortedByRecent.filter((session) => {
    if (keepIds.has(session.id)) return false
    const perms = options.permission[session.id] ?? []
    return perms.length > 0
  })

  const merged = new Map<string, Session>()
  for (const session of [...keep, ...keepPermission]) {
    merged.set(session.id, session)
  }

  return [...merged.values()].sort((a, b) => cmp(a.id, b.id))
}
