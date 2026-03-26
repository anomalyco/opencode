type ProjectLike = {
  worktree: string
  sandboxes?: string[]
}

export function projectForDirectory<T extends ProjectLike>(
  projects: T[],
  directory: string,
  norm = (value: string) => value,
) {
  const key = norm(directory)
  const direct = projects.find((project) => norm(project.worktree) === key)
  if (direct) return direct
  return projects.find((project) => project.sandboxes?.some((sandbox) => norm(sandbox) === key))
}

export function sandboxRoots<T extends ProjectLike>(projects: T[], norm = (value: string) => value) {
  const worktrees = new Set(projects.map((project) => norm(project.worktree)))
  const map = new Map<string, string>()
  for (const project of projects) {
    for (const sandbox of project.sandboxes ?? []) {
      const key = norm(sandbox)
      if (worktrees.has(key)) continue
      map.set(key, project.worktree)
    }
  }
  return map
}
