import { pathKey } from "@/utils/path-key"
import { displayName } from "@/pages/layout/helpers"
import type { LocalProject } from "@/context/layout"

export type ClosedFilter = "recent" | "archived" | "hidden" | "all"
export type ClosedSort = "recent" | "oldest" | "name-asc" | "name-desc"

export type ClosedEntry<T extends LocalProject = LocalProject> = {
  project: T
  hidden: boolean
  archived: boolean
}

export function closedEntries<T extends LocalProject>(
  items: T[],
  isHidden: (directory: string) => boolean,
  isArchived: (directory: string) => boolean,
): ClosedEntry<T>[] {
  return items.map((project) => ({
    project,
    hidden: isHidden(project.worktree),
    archived: isArchived(project.worktree),
  }))
}

export function matchesClosedQuery(project: LocalProject, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (displayName(project).toLowerCase().includes(needle)) return true
  const path = pathKey(project.worktree).toLowerCase()
  return path.includes(needle) || path.includes(needle.replaceAll("\\", "/"))
}

export function filterClosedEntries<T extends LocalProject>(entries: ClosedEntry<T>[], filter: ClosedFilter) {
  if (filter === "all") return entries
  if (filter === "archived") return entries.filter((entry) => entry.archived)
  if (filter === "hidden") return entries.filter((entry) => entry.hidden)
  return entries.filter((entry) => !entry.hidden && !entry.archived)
}

// History is stored most recent first, so "recent" is the stored order and "oldest" its
// reverse. Name sorts break ties by path and then by history position, so equal names stay
// deterministic and Z–A is the exact mirror of A–Z.
export function sortClosedEntries<T extends LocalProject>(entries: ClosedEntry<T>[], sort: ClosedSort) {
  if (sort === "recent") return entries
  if (sort === "oldest") return [...entries].reverse()
  const direction = sort === "name-asc" ? 1 : -1
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        direction *
        (displayName(a.entry.project).localeCompare(displayName(b.entry.project), undefined, { sensitivity: "base" }) ||
          pathKey(a.entry.project.worktree).localeCompare(pathKey(b.entry.project.worktree)) ||
          a.index - b.index),
    )
    .map((item) => item.entry)
}

export function countClosedEntries(entries: ClosedEntry[]) {
  return {
    all: entries.length,
    recent: entries.filter((entry) => !entry.hidden && !entry.archived).length,
    archived: entries.filter((entry) => entry.archived).length,
    hidden: entries.filter((entry) => entry.hidden).length,
  }
}
