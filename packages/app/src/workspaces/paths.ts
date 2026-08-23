import { pathKey } from "@/workspaces/path-key"
import type { WorkspaceDefaultDestination, WorkspaceLastUsed } from "@/settings/model"
import type { SessionInfo, WorktreeDirectory } from "@opencode-ai/client/promise"

type WorkspaceProject = {
  worktree: string
  sandboxes?: readonly string[]
  worktrees?: readonly WorktreeDirectory[]
}

export function workspaceDirectories(project: WorkspaceProject) {
  return (project.sandboxes ?? []).filter((directory) => !sameDirectory(project.worktree, directory))
}

export function managedWorkspaceDirectories(project: WorkspaceProject) {
  return (project.worktrees ?? [])
    .filter((worktree) => worktree.strategy !== undefined)
    .map((worktree) => worktree.directory)
    .filter((directory) => !sameDirectory(project.worktree, directory))
}

export function workspaceInventory<T extends WorkspaceProject & { id: string }>(projects: readonly T[]) {
  return projects.flatMap((project) =>
    managedWorkspaceDirectories(project).map((directory) => ({ directory, project })),
  )
}

export function filterWorkspaceInventory<T extends { project: { id: string } }>(
  workspaces: readonly T[],
  project: string,
) {
  if (project === "all") return [...workspaces]
  return workspaces.filter((workspace) => workspace.project.id === project)
}

export function sessionsForWorkspace(sessions: readonly SessionInfo[], workspace: string) {
  return sessions
    .filter((session) => session.time.archived === undefined)
    .filter((session) => containsDirectory(workspace, session.location.directory))
    .toSorted((a, b) => b.time.updated - a.time.updated)
}

export function mergeWorkspaceSessionInventory(server: readonly SessionInfo[], cached: readonly SessionInfo[]) {
  const sessions = new Map(server.map((session) => [session.id, session]))
  cached.forEach((session) => {
    const current = sessions.get(session.id)
    if (!current || session.time.updated > current.time.updated) sessions.set(session.id, session)
  })
  return [...sessions.values()]
}

export function removeWorkspacesSequentially<T>(workspaces: readonly T[], remove: (workspace: T) => Promise<void>) {
  return workspaces.reduce((previous, workspace) => previous.then(() => remove(workspace)), Promise.resolve())
}

export type WorkspaceDeleteInspection = {
  active: boolean
  linked: boolean
  dirty: boolean
}

export function inspectWorkspaceDeletion(input: {
  workspace: string
  activeDirectory?: string
  sessions: readonly SessionInfo[]
  status: "clean" | "dirty"
}): WorkspaceDeleteInspection {
  return {
    active: !!input.activeDirectory && containsDirectory(input.workspace, input.activeDirectory),
    linked: input.sessions.some(
      (session) =>
        session.time.archived === undefined && containsDirectory(input.workspace, session.location.directory),
    ),
    dirty: input.status === "dirty",
  }
}

export function isWorkspaceDirectory(project: WorkspaceProject | undefined, directory: string) {
  if (!project || sameDirectory(project.worktree, directory)) return false
  return workspaceDirectories(project).some((workspace) => containsDirectory(workspace, directory))
}

export function isProjectDirectory(project: WorkspaceProject | undefined, directory: string) {
  if (!project) return false
  return [project.worktree, ...(project.sandboxes ?? [])].some((root) => containsDirectory(root, directory))
}

export function containsDirectory(parent: string, child: string) {
  const normalize = (value: string) => {
    const key = pathKey(value)
    return /^[a-z]:\//i.test(key) || key.startsWith("//") ? key.toLowerCase() : key
  }
  const root = normalize(parent)
  const target = normalize(child)
  return target === root || target.startsWith(root.endsWith("/") ? root : `${root}/`)
}

export function sameDirectory(a: string, b: string) {
  return containsDirectory(a, b) && containsDirectory(b, a)
}

export function isWorkspaceSelection(project: WorkspaceProject | undefined, selection: string) {
  if (selection === "main" || selection === "create") return true
  if (!project) return false
  if (sameDirectory(project.worktree, selection)) return true
  return isWorkspaceDirectory(project, selection)
}

export function workspaceDefaultSelection(
  setting: WorkspaceDefaultDestination,
  lastUsed: WorkspaceLastUsed | undefined,
) {
  if (setting === "local") return "main"
  if (setting === "new") return "create"
  return lastUsed === "workspace" ? "create" : "main"
}
