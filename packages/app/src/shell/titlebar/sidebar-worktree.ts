import { containsDirectory, getFilename, sameDirectory } from "@opencode/util/path"
import type { Project } from "@/runtime/server/types"
import { managedWorkspaceDirectories, workspaceDirectories } from "@/workspaces/paths"

export type WorktreeBadge = { label: string; color: string }

const hueOf = (value: string) =>
  Array.from(value).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % 360

/**
 * The badge for the worktree that contains the session's directory, or undefined when the project has no worktrees.
 * A session started in a subdirectory belongs to the worktree that contains it, so the label and color come from the
 * worktree root, not from the session directory.
 */
export function worktreeBadge(
  directory: string | undefined,
  project: Project | undefined,
  local: string,
): WorktreeBadge | undefined {
  if (!directory || !project?.worktree) return undefined

  const entries = [
    project.worktree,
    ...workspaceDirectories(project),
    ...(project.worktrees ?? []).map((worktree) => worktree.directory),
    ...managedWorkspaceDirectories(project),
  ].filter((entry, index, items) => items.findIndex((item) => sameDirectory(item, entry)) === index)

  if (entries.length <= 1) return undefined

  const containing = entries
    .filter((entry) => containsDirectory(entry, directory))
    .toSorted((a, b) => b.length - a.length)[0]

  if (!containing) return undefined

  const color = `hsl(${hueOf(containing)} 65% 55%)`

  if (sameDirectory(containing, project.worktree)) return { label: local, color }

  const name = getFilename(containing)
  const root = getFilename(project.worktree)

  return {
    label: root && name.startsWith(`${root}-`) ? name.slice(root.length + 1) : name,
    color,
  }
}
