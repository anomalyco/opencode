import { Project } from "./project"
import { ProjectID } from "./schema"

/**
 * Map a path handle (worktree, or `/projects/<id>`) to a Project value for `Instance.provide`.
 */
export function localProject(path: string): Project.Info & { vcs: "git" | undefined } {
  const now = Date.now()
  const match = /^\/projects\/(.+)$/.exec(path)
  return {
    id: ProjectID.make(match ? match[1] : path),
    time: {
      created: now,
      updated: now,
    },
    vcs: match ? undefined : ("git" as const),
  }
}
