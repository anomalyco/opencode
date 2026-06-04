import { base64Encode } from "@opencode-ai/core/util/encode"
import { pathKey } from "@/utils/path-key"

export function projectBottomBarHref(project: { worktree: string }) {
  return `/?project=${base64Encode(project.worktree)}`
}

export function isProjectBottomBarActive(
  activeDirectory: string | undefined,
  project: { worktree: string; sandboxes?: string[] },
) {
  if (!activeDirectory) return false
  const activeKey = pathKey(activeDirectory)
  return [project.worktree, ...(project.sandboxes ?? [])].some((directory) => pathKey(directory) === activeKey)
}
