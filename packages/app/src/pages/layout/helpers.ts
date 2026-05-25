import { getFilename } from "@opencode-ai/core/util/path"
import { type PermissionRequest, type Session } from "@opencode-ai/sdk/v2/client"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

export type ProjectOwnerInput = {
  worktree: string
  sandboxes?: string[]
}

export type ProjectOwner<T extends ProjectOwnerInput> = {
  project: T
  root: string
  directory: string
  sandbox: boolean
}

export const workspaceKey = (directory: string) => {
  const value = directory.replaceAll("\\", "/")
  const drive = value.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1]}/`
  if (/^\/+$/i.test(value)) return "/"
  return value.replace(/\/+$/, "")
}

export const canonicalWorkspaceDir = (route: string, canonical?: string) => {
  if (!canonical) return route
  if (workspaceKey(route) !== workspaceKey(canonical)) return route
  return canonical
}

export function projectOwner<T extends ProjectOwnerInput>(directory: string | undefined, projects: T[]) {
  if (!directory) return
  const key = workspaceKey(directory)
  if (!key) return

  const exact = projects.find((item) => workspaceKey(item.worktree) === key)
  if (exact) {
    const stale = projects.find(
      (item) =>
        workspaceKey(item.worktree) !== key && item.sandboxes?.some((sandbox) => workspaceKey(sandbox) === key),
    )
    if (stale) {
      console.debug("[layout] project owner ignored sandbox because worktree matched first", {
        directory,
        worktree: exact.worktree,
        sandboxOf: stale.worktree,
      })
    }
    return {
      project: exact,
      root: exact.worktree,
      directory: exact.worktree,
      sandbox: false,
    } satisfies ProjectOwner<T>
  }

  for (const item of projects) {
    const sandbox = item.sandboxes?.find((entry) => workspaceKey(entry) === key)
    if (!sandbox) continue
    return {
      project: item,
      root: item.worktree,
      directory: sandbox,
      sandbox: true,
    } satisfies ProjectOwner<T>
  }
}

export async function waitForMatch<T>(
  read: () => T,
  match: (value: T) => boolean,
  opts?: { tries?: number; delay?: number },
) {
  const tries = opts?.tries ?? 20
  const delay = opts?.delay ?? 10
  for (let count = 0; count < tries; count += 1) {
    await new Promise((resolve) => setTimeout(resolve, delay))
    if (match(read())) return
  }
}

function sortSessions(now: number) {
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

const isRootVisibleSession = (session: Session, directory: string) =>
  workspaceKey(session.directory) === workspaceKey(directory) && !session.parentID && !session.time?.archived

const roots = (store: SessionStore) =>
  (store.session ?? []).filter((session) => isRootVisibleSession(session, store.path.directory))

export const sortedRootSessions = (store: SessionStore, now: number) => roots(store).sort(sortSessions(now))

export const sortedProjectSessions = (stores: SessionStore[], now: number) => stores.flatMap(roots).sort(sortSessions(now))

export const latestRootSession = (stores: SessionStore[], now: number) =>
  sortedProjectSessions(stores, now)[0]

export const latestWorkspaceSession = (store: SessionStore, now: number) => latestRootSession([store], now)

export const latestProjectSession = (
  input: {
    root: string
    dirs: string[]
    recent?: { directory: string; id: string; at: number }
    stores: SessionStore[]
  },
  now: number,
) => {
  const key = workspaceKey(input.root)
  const dirs = input.dirs.filter((dir) => workspaceKey(dir) !== key)
  const all = [input.root, ...dirs]
  const recent =
    input.recent &&
    all.some((dir) => workspaceKey(dir) === workspaceKey(input.recent!.directory)) &&
    input.stores
      .flatMap(roots)
      .find(
        (session) =>
          workspaceKey(session.directory) === workspaceKey(input.recent!.directory) && session.id === input.recent!.id,
      )
  if (recent) return recent
  return latestRootSession(input.stores, now)
}

export function hasProjectPermissions(
  session: Session[],
  request: Record<string, PermissionRequest[] | undefined>,
  directory: string,
  include: (item: PermissionRequest) => boolean = () => true,
) {
  const children = childMapByParent(session)
  return session
    .filter((item) => isRootVisibleSession(item, directory))
    .some((root) => {
      const seen = new Set([root.id])
      const ids = [root.id]
      for (const id of ids) {
        const list = children.get(id)
        if (!list) continue
        for (const child of list) {
          if (seen.has(child)) continue
          seen.add(child)
          ids.push(child)
        }
      }
      return ids.some((id) => request[id]?.some(include))
    })
}

export const childMapByParent = (sessions: Session[] | undefined) => {
  const map = new Map<string, string[]>()
  for (const session of sessions ?? []) {
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

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export type SessionGroupKey = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older"

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function sessionGroupKey(session: Session, now: number): SessionGroupKey {
  const today = startOfDay(now)
  const t = session.time.updated ?? session.time.created
  if (t >= today) return "today"
  if (t >= today - 86_400_000) return "yesterday"
  if (t >= today - 7 * 86_400_000) return "thisWeek"
  if (t >= today - 30 * 86_400_000) return "thisMonth"
  return "older"
}

/** Returns a Map from session ID to its group key, only for sessions that START a new group. */
export function sessionGroupBoundaries(sessions: Session[], now: number): Map<string, SessionGroupKey> {
  const headers = new Map<string, SessionGroupKey>()
  let lastKey: SessionGroupKey | undefined
  for (const session of sessions) {
    const key = sessionGroupKey(session, now)
    if (key !== lastKey) {
      headers.set(session.id, key)
      lastKey = key
    }
  }
  return headers
}

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
