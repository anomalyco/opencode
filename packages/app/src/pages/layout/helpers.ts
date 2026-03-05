import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { type Session } from "@opencode-ai/sdk/v2/client"

export type ProjectGroup<T extends { worktree: string }> = {
  id: string
  label: string
  projects: T[]
}

const manualProjectGroupID = (directory: string) => `project:${workspaceKey(directory)}`

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

export const latestRootSession = (stores: { session: Session[]; path: { directory: string } }[], now: number) =>
  stores
    .flatMap((store) => store.session.filter((session) => isRootVisibleSession(session, store.path.directory)))
    .sort(sortSessions(now))[0]

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

export const projectGroupID = (directory: string) => {
  const parent = workspaceKey(getDirectory(workspaceKey(directory)))
  return parent || workspaceKey(directory)
}

export const projectGroupLabel = (id: string) => {
  const name = getFilename(id)
  if (name) return name
  if (id === "/" || id === "\\") return id
  return id.replace(/[\\/]+$/, "")
}

export const createProjectGroups = <T extends { worktree: string; name?: string }>(
  projects: T[],
  parentByProject: Record<string, string> = {},
) => {
  const normalizedParent = Object.entries(parentByProject).reduce(
    (acc, [child, parent]) => {
      const key = workspaceKey(child)
      const root = workspaceKey(parent)
      if (!key || !root || key === root) return acc
      acc[key] = root
      return acc
    },
    {} as Record<string, string>,
  )

  const parentSet = new Set(Object.values(normalizedParent))
  const projectByWorktree = new Map(projects.map((project) => [workspaceKey(project.worktree), project]))
  const groups = new Map<string, ProjectGroup<T>>()
  for (const project of projects) {
    const key = workspaceKey(project.worktree)
    const parent = normalizedParent[key]
    const id = parent
      ? manualProjectGroupID(parent)
      : parentSet.has(key)
        ? manualProjectGroupID(key)
        : projectGroupID(project.worktree)

    const group = groups.get(id)
    if (group) {
      group.projects.push(project)
      continue
    }

    const label = id.startsWith("project:")
      ? displayName(projectByWorktree.get(id.slice("project:".length)) ?? { worktree: id.slice("project:".length) })
      : projectGroupLabel(id)

    groups.set(id, {
      id,
      label,
      projects: [project],
    })
  }

  const grouped = [...groups.values()].map((group) => {
    if (!group.id.startsWith("project:")) return group
    const root = group.id.slice("project:".length)
    const projects = group.projects.slice().sort((a, b) => {
      const aRoot = workspaceKey(a.worktree) === root
      const bRoot = workspaceKey(b.worktree) === root
      if (aRoot && !bRoot) return -1
      if (!aRoot && bRoot) return 1
      return 0
    })
    return {
      ...group,
      projects,
    }
  })

  return [
    {
      id: "all",
      label: "All projects",
      projects,
    },
    ...grouped,
  ]
}

export const syncWorkspaceOrder = effectiveWorkspaceOrder
