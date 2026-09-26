import { getFilename } from "@opencode/util/path"
import type { SessionInfo } from "@opencode/client/promise"
import { pathKey } from "@/workspaces/path-key"
import { isProjectDirectory } from "@/workspaces/paths"
import type { ServerConnection } from "@/runtime/server/registry"
import type { HomeProjectSelection } from "@/shell/state/layout"

type SessionStore = {
  session?: SessionInfo[]
  path: { directory: string }
}

export function compareSessionTime(a: SessionInfo, b: SessionInfo) {
  const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)
  if (updated !== 0) return updated
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const isRootVisibleSession = (session: SessionInfo, directory: string) =>
  pathKey(session.location.directory) === pathKey(directory) && !session.parentID && !session.time.archived

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

export const childSessionOnPath = (sessions: SessionInfo[] | undefined, rootID: string, activeID?: string) => {
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

type ProjectAppearance = {
  name?: string
  worktree: string
  icon?: { color?: string; url?: string; override?: string }
}

function withProjectAppearance<T extends ProjectAppearance>(metadata: T, appearance?: ProjectAppearance) {
  if (!appearance || appearance === metadata) return metadata
  return { ...metadata, name: displayName(appearance), icon: appearance.icon }
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
  session: SessionInfo,
  projects: T[],
) {
  const matching = projects.filter((project) => project.id === session.projectID)
  if (matching.length === 1) return matching[0]
  if (matching.length > 1) {
    const directory = pathKey(session.location.directory)
    const exact =
      matching.find((project) => pathKey(project.worktree) === directory) ??
      matching.find((project) => project.sandboxes?.some((sandbox) => pathKey(sandbox) === directory))
    if (exact) return exact
    return (
      matching
        .filter((project) => isProjectDirectory(project, session.location.directory))
        .sort((a, b) => b.worktree.length - a.worktree.length)[0] ?? matching.at(-1)
    )
  }
  const directory = pathKey(session.location.directory)
  const exact =
    projects.find((project) => pathKey(project.worktree) === directory) ??
    projects.find((project) => project.sandboxes?.some((sandbox) => pathKey(sandbox) === directory))
  if (exact) return exact
  return projects
    .filter((project) => isProjectDirectory(project, session.location.directory))
    .sort((a, b) => b.worktree.length - a.worktree.length)[0]
}

export function resolveProjectForSession<
  T extends { id?: string; worktree: string; sandboxes?: string[] },
  U extends { id?: string; worktree: string; sandboxes?: string[] },
>(session: SessionInfo, opened: T[], stored: U[]) {
  const current = projectForSession(session, opened)
  if (current?.id === session.projectID) {
    const unresolved = opened.find(
      (project) => !project.id && pathKey(project.worktree) === pathKey(session.location.directory),
    )
    if (!unresolved) return current
    const canonical = projectForSession(session, stored)
    if (canonical?.id === session.projectID && pathKey(canonical.worktree) === pathKey(unresolved.worktree))
      return unresolved
    return current
  }
  const synced = projectForSession(session, stored)
  if (synced?.id !== session.projectID) return current ?? synced
  if (current && !current.id && pathKey(current.worktree) === pathKey(session.location.directory)) return current
  return synced
}

export function resolveSessionDetailsProject<
  T extends ProjectAppearance & { id?: string; sandboxes?: string[] },
  U extends ProjectAppearance & { id?: string; sandboxes?: string[] },
>(session: SessionInfo, opened: T[], stored: U[]) {
  const metadata = projectForSession(session, stored)
  if (!metadata) return
  return withProjectAppearance(metadata, resolveProjectForSession(session, opened, stored))
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
