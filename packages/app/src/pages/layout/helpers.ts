import { getFilename } from "@opencode-ai/core/util/path"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { pathKey } from "@/utils/path-key"
import type { ServerConnection } from "@/context/server"
import type { HomeProjectSelection } from "@/context/layout"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

export function compareSessionTime(a: Session, b: Session) {
  const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)
  if (updated !== 0) return updated
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const isRootVisibleSession = (session: Session, directory: string) =>
  pathKey(session.directory) === pathKey(directory) && !session.parentID && !session.time?.archived

export const roots = (store: SessionStore) =>
  (store.session ?? []).filter((session) => isRootVisibleSession(session, store.path.directory))

export const sortedRootSessions = (store: SessionStore, _now: number) => roots(store).sort(compareSessionTime)

export const latestRootSession = (stores: SessionStore[], _now: number) =>
  stores.flatMap(roots).sort(compareSessionTime)[0]

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const childSessionOnPath = (sessions: Session[] | undefined, rootID: string, activeID?: string) => {
  if (!activeID || activeID === rootID) return
  const map = new Map((sessions ?? []).map((session) => [session.id, session]))
  let id = activeID

  while (id) {
    const session = map.get(id)
    if (!session?.parentID) return
    if (session.parentID === rootID) return session
    id = session.parentID
  }
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree) || project.worktree

export type HistoryTreeProject = { worktree: string; name?: string; sandboxes?: string[] }

export type HistoryTreeGroup<T extends HistoryTreeProject = HistoryTreeProject> = {
  project: T
  projectName: string
  sessions: Session[]
}

export function projectOwnsDirectory(project: HistoryTreeProject, directory: string) {
  const dir = pathKey(directory)
  const root = pathKey(project.worktree)
  if (dir === root) return true
  if (project.sandboxes?.some((sandbox) => pathKey(sandbox) === dir)) return true
  return dir.startsWith(`${root}/`)
}

export function historyTreeProjectForDirectory<T extends HistoryTreeProject>(projects: T[], directory: string) {
  return projects
    .filter((project) => projectOwnsDirectory(project, directory))
    .sort((left, right) => pathKey(right.worktree).length - pathKey(left.worktree).length)[0]
}

export function historyTreeGroups<T extends HistoryTreeProject>(
  projects: T[],
  sessions: Session[],
): HistoryTreeGroup<T>[] {
  const buckets = new Map(
    projects.map((project) => [
      pathKey(project.worktree),
      { project, projectName: displayName(project), sessions: [] as Session[] },
    ]),
  )
  for (const session of sessions) {
    if (session.parentID) continue
    if (session.time?.archived) continue
    const project = historyTreeProjectForDirectory(projects, session.directory)
    if (!project) continue
    buckets.get(pathKey(project.worktree))?.sessions.push(session)
  }
  return [...buckets.values()].map((group) => ({
    ...group,
    sessions: group.sessions.sort(compareSessionTime),
  }))
}

export function toggleHomeProjectSelection(
  current: HomeProjectSelection | undefined,
  server: ServerConnection.Key,
  directory: string,
): HomeProjectSelection {
  if (current?.server === server && current.directory === directory) return { server }
  return { server, directory }
}

export function closeHomeProject(
  selected: HomeProjectSelection | undefined,
  server: ServerConnection.Key,
  projects: { close: (directory: string) => void },
  directory: string,
) {
  projects.close(directory)
  if (selected?.server === server && selected.directory === directory) return { server }
  return selected
}

export function homeProjectNavigation(active: ServerConnection.Key, server: ServerConnection.Key, href: string) {
  if (active === server) return { href }
  return { server, href }
}

export function homeProjectDirectories(result: string | string[] | null) {
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

export function homeSessionServerStatus(active: boolean, status: () => { working: boolean; tint?: string }) {
  if (!active) return { working: false, tint: undefined }
  return status()
}

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export function getProjectAvatarSource(id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (id === OPENCODE_PROJECT_ID) return "https://opencode.ai/favicon.svg"
  if (icon?.override) return icon.override
  if (icon?.color) return undefined
  return icon?.url
}

export function projectForSession<T extends { id?: string; worktree: string; sandboxes?: string[] }>(
  session: Session,
  projects: T[],
  byID: Map<string, T> = new Map(projects.flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
) {
  const direct = byID.get(session.projectID)
  if (direct) return direct
  const directory = pathKey(session.directory)
  return projects.find(
    (project) =>
      pathKey(project.worktree) === directory || project.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
  )
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
  const root = pathKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = pathKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = pathKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}
