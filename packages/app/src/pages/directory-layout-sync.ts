export function projectRoot(directory: string | undefined, worktree: string | undefined) {
  const root = worktree && worktree !== "/" ? worktree : directory
  if (!root) return
  return root
}

export function syncProject(
  synced: string | undefined,
  directory: string | undefined,
  worktree: string | undefined,
  open: (directory: string) => void,
  close?: (directory: string) => void,
) {
  const root = projectRoot(directory, worktree)
  if (!root) return synced
  if (root === synced) return synced
  if (synced) close?.(synced)
  open(root)
  return root
}
