/**
 * The directory the titlebar's New session action starts in.
 *
 * The projects the client has opened come first, in the order the home screen picks them: the one
 * selected there, then the last one used, then the first one known. A client that has never opened
 * a project has no such list, so it answers with nothing and the caller falls back to the server's
 * own directory — which only the server can report.
 */
export function newSessionTarget(input: { projects: string[]; selected?: string; last?: string }) {
  const selected = input.projects.find((worktree) => worktree === input.selected)

  if (selected) return selected
  const last = input.projects.find((worktree) => worktree === input.last)

  if (last) return last
  return input.projects[0]
}
