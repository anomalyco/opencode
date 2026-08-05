import type { Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import { displayName, projectForSession } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"

export type HomeSessionRecord = {
  session: Session
  project: LocalProject
  projectName: string
}

export function buildHomeSessionRecords(input: {
  sessions: () => Session[]
  projectDirectories: () => string[]
  projects: () => LocalProject[]
  projectByID: () => Map<string, LocalProject>
}) {
  const projectDirectories = input.projectDirectories()
  const directories = new Set(projectDirectories.map(pathKey))
  const sessions = projectDirectories.length
    ? input.sessions().filter((session) => directories.has(pathKey(session.directory)))
    : input.sessions()
  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    .flatMap((session) => {
      const directory = pathKey(session.directory)
      const project =
        input
          .projects()
          .find(
            (item) =>
              pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
          ) ??
        projectForSession(session, input.projects(), input.projectByID()) ?? { worktree: session.directory, expanded: false }
      return { session, project, projectName: displayName(project) }
    })
}
