import { pathKey } from "@/utils/path-key"

export function knownProjectWorktrees(input: {
  open: string[]
  recentlyClosed: string[]
  known: string[]
  limit: number
}) {
  const hidden = new Set([...input.open, ...input.recentlyClosed].map(pathKey))
  return input.known.filter((worktree) => !hidden.has(pathKey(worktree))).slice(0, input.limit)
}
