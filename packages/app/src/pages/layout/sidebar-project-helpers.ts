import { workspaceKey } from "./helpers"

export const projectSelected = (current: string | undefined, worktree: string, _sandboxes?: string[]) => {
  const key = workspaceKey(current ?? "")
  if (!key) return false
  return workspaceKey(worktree) === key
}
