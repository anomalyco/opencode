import { getFilename } from "@opencode-ai/util/path"
import { type Session } from "@opencode-ai/sdk/v2/client"

export const workspaceKey = (directory: string) => {
  const drive = directory.match(/^([A-Za-z]:)[\\/]+$/)
  if (drive) return `${drive[1]}${directory.includes("\\") ? "\\" : "/"}`
  if (/^[\\/]+$/.test(directory)) return directory.includes("\\") ? "\\" : "/"
  return directory.replace(/[\\/]+$/, "")
}

export function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

export const isRootVisibleSession = (session: Session, directory: string) =>
  workspaceKey(session.directory) === workspaceKey(directory) && !session.parentID && !session.time?.archived

export const sortedRootSessions = (store: { session: Session[]; path: { directory: string } }, now: number) =>
  store.session.filter((session) => isRootVisibleSession(session, store.path.directory)).sort(sortSessions(now))

export const topRootSessions = (
  store: { session: Session[]; path: { directory: string } },
  now: number,
  limit: number,
) => {
  if (limit <= 0) return [] as Session[]
  const sort = sortSessions(now)
  return store.session.reduce((list, session) => {
    if (!isRootVisibleSession(session, store.path.directory)) return list
    const index = list.findIndex((item) => sort(session, item) < 0)
    if (index === -1) {
      if (list.length < limit) list.push(session)
      return list
    }
    list.splice(index, 0, session)
    if (list.length > limit) list.pop()
    return list
  }, [] as Session[])
}

export const nextRootStart = (store: { session: Session[]; path: { directory: string } }, now: number) => {
  const latest = topRootSessions(store, now, 1)[0]
  if (!latest) return undefined
  return (latest.time.updated ?? latest.time.created) + 1
}

export const staleSession = (session: { at: number } | undefined, now: number, ttl: number) => {
  if (!session) return true
  return now - session.at > ttl
}

export const latestRootSession = (stores: { session: Session[]; path: { directory: string } }[], now: number) => {
  const sort = sortSessions(now)
  return stores.reduce(
    (best, store) =>
      store.session.reduce((next, session) => {
        if (!isRootVisibleSession(session, store.path.directory)) return next
        if (!next) return session
        return sort(session, next) < 0 ? session : next
      }, best),
    undefined as Session | undefined,
  )
}

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined>,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request).some((list) => list?.some(include))
}

export const childMapByParent = (sessions: Session[]) => {
  const map = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const existing = map.get(session.parentID)
    if (existing) {
      existing.push(session.id)
      continue
    }
    map.set(session.parentID, [session.id])
  }
  return map
}

export function getDraggableId(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined
  if (!("draggable" in event)) return undefined
  const draggable = (event as { draggable?: { id?: unknown } }).draggable
  if (!draggable) return undefined
  return typeof draggable.id === "string" ? draggable.id : undefined
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = workspaceKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = workspaceKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = workspaceKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}

export const syncWorkspaceOrder = effectiveWorkspaceOrder
