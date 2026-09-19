import { pathKey } from "@/utils/path-key"

// `last` is a browser-local value keyed only by server host:port, so it can point at a
// stale project from an unrelated launch of the same server (e.g. a previous WSL home
// directory session). Prefer the project matching the server's actual launch directory.
export function selectAutoselectProject(input: {
  list: { worktree: string }[]
  last: string | undefined
  launchDirectory: string | undefined
}) {
  if (input.list.length === 0) return input.last

  const launchKey = input.launchDirectory ? pathKey(input.launchDirectory) : undefined
  const launched = launchKey && input.list.find((project) => pathKey(project.worktree) === launchKey)
  return (launched || input.list.find((project) => project.worktree === input.last) || input.list[0])?.worktree
}
