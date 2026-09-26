export interface ProjectWorktree {
  readonly id: string
  readonly worktree: string
}

export interface ProjectMove {
  readonly id: string
  readonly from: string
  readonly to: string
}

/**
 * Tracks the last seen worktree per project id and reports transitions.
 *
 * A moved or renamed project folder keeps its identity through the repo-local
 * id file, and the server adopts the new path the next time the project is
 * opened from its new location. Observing the worktree change here lets the
 * client relocate path-keyed state (open-project entries, last-project) so
 * the old entry does not linger at the dead location while the new path
 * shows up as a separate project.
 */
export function trackProjectMoves(seen: Map<string, string>, projects: readonly ProjectWorktree[]): ProjectMove[] {
  const moves: ProjectMove[] = []
  for (const project of projects) {
    const previous = seen.get(project.id)
    seen.set(project.id, project.worktree)
    if (previous && previous !== project.worktree) {
      moves.push({ id: project.id, from: previous, to: project.worktree })
    }
  }
  return moves
}
