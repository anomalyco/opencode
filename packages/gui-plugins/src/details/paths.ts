import { sameDirectory } from "@opencode/util/path"

/** The parts of a project that name its checkouts. */
export type WorkspaceProject = {
  readonly worktree: string
  readonly sandboxes?: readonly string[]
  readonly worktrees?: readonly { readonly directory: string }[]
}

/** The project's worktrees other than its root, from its sandboxes and the worktrees found on disk. */
export function workspaceDirectories(project: WorkspaceProject) {
  return [...(project.sandboxes ?? []), ...(project.worktrees ?? []).map((item) => item.directory)].filter(
    (directory, index, all) =>
      !sameDirectory(project.worktree, directory) &&
      all.findIndex((candidate) => sameDirectory(candidate, directory)) === index,
  )
}
