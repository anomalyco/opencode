import type { SessionInfo } from "@opencode-ai/client/promise"
import type { LocalProject } from "@/shell/state/layout"
import { compareSessionTime, displayName } from "@/shell/layout/helpers"
import { pathKey } from "@/workspaces/path-key"

export type HomeSessionRecord = {
  session: SessionInfo
  project: LocalProject
  projectName: string
}

export function buildHomeSessionRecords(input: {
  sessions: () => SessionInfo[]
  projectDirectories: () => string[] | undefined
  projects: () => LocalProject[]
}) {
  const selected = input.projectDirectories()
  const directories = selected ? new Set(selected.map(pathKey)) : undefined
  const sessions = directories
    ? input.sessions().filter((session) => directories.has(pathKey(session.location.directory)))
    : input.sessions()
  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort(compareSessionTime)
    .map((session) => {
      const project = homeProjectForSession(session, input.projects()) ?? {
        id: session.projectID,
        worktree: session.location.directory,
        expanded: false,
      }
      return { session, project, projectName: displayName(project) }
    })
}

// Worktree inventories load on demand, so a worktree session may not match any directory yet;
// the session's project ID still identifies its added project.
export function homeProjectForSession<T extends { id?: string; worktree: string; sandboxes?: readonly string[] }>(
  session: SessionInfo,
  projects: readonly T[],
) {
  const directory = pathKey(session.location.directory)
  return (
    projects.find(
      (item) =>
        pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
    ) ?? projects.find((item) => item.id === session.projectID)
  )
}
