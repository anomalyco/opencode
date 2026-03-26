export function syncProject(
  directory: string | undefined,
  worktree: string | undefined,
  open: (directory: string) => void,
) {
  const root = worktree && worktree !== "/" ? worktree : directory
  if (!root) return
  open(root)
}
