export const projectSelected = (currentDir: string, worktree: string, sandboxes?: string[]) =>
  worktree === currentDir || sandboxes?.includes(currentDir) === true
