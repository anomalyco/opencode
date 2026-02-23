export const projectSelected = (currentDir: string, worktree: string, sandboxes?: string[]) =>
  worktree === currentDir || sandboxes?.includes(currentDir) === true

export const projectTileActive = (args: {
  menu: boolean
  preview: boolean
  open: boolean
  overlay: boolean
  hoverProject?: string
  worktree: string
}) => args.menu || (args.preview ? args.open : args.overlay && args.hoverProject === args.worktree)

export const parentName = (path: string) => {
  const clean = path.replace(/[\\/]+$/, "")
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"))
  if (idx <= 0) return ""
  return clean.slice(0, idx).replace(/^.*[\\/]/, "")
}
