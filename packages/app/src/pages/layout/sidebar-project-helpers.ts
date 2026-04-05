import { workspaceKey } from "./helpers"

export const projectSelected = (currentDir: string, worktree: string, sandboxes?: string[]) => {
  const key = workspaceKey(currentDir)
  if (!key) return false
  if (workspaceKey(worktree) === key) return true
  return sandboxes?.some((item) => workspaceKey(item) === key) === true
}
