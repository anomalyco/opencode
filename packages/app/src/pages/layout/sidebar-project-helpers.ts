export const projectSelected = (currentDir: string, worktree: string, sandboxes?: string[]) =>
  worktree === currentDir || sandboxes?.includes(currentDir) === true

export type ProjectIconStatus = "pending" | "errored" | "completed" | "running" | "idle"

export const projectIconStatus = (args: {
  pending: boolean
  errored: boolean
  completed: boolean
  running: boolean
}): ProjectIconStatus => {
  if (args.pending) return "pending"
  if (args.errored) return "errored"
  if (args.completed) return "completed"
  if (args.running) return "running"
  return "idle"
}

export const projectTileActive = (args: {
  menu: boolean
  preview: boolean
  open: boolean
  overlay: boolean
  hoverProject?: string
  worktree: string
}) => args.menu || (args.preview ? args.open : args.overlay && args.hoverProject === args.worktree)
