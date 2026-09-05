import { pathKey } from "@/utils/path-key"
import { displayName } from "@/pages/layout/helpers"
import type { LocalProject } from "@/context/layout"

export type ClosedFilter = "all" | "recent" | "archived" | "hidden"
export type ClosedSort = "recent" | "name-asc" | "name-desc"

export type ClosedProjectState = {
  hidden: boolean
  archived: boolean
}

export function closedState(
  worktree: string,
  isHidden: (directory: string) => boolean,
  isArchived: (directory: string) => boolean,
): ClosedProjectState {
  return { hidden: isHidden(worktree), archived: isArchived(worktree) }
}

export function isRecentVisible(state: ClosedProjectState) {
  return !state.hidden && !state.archived
}

export function matchesClosedQuery(project: LocalProject, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const name = displayName(project).toLowerCase()
  if (name.includes(needle)) return true
  if (project.worktree.toLowerCase().includes(needle)) return true
  return project.worktree.toLowerCase().includes(needle.replaceAll("\\", "/"))
}

export function filterClosedByState<T extends LocalProject>(
  items: T[],
  states: Map<string, ClosedProjectState> | ((directory: string) => ClosedProjectState),
  filter: ClosedFilter,
) {
  const get = typeof states === "function" ? states : (directory: string) => states.get(pathKey(directory)) ?? { hidden: false, archived: false }
  if (filter === "all") return items
  return items.filter((project) => {
    const state = get(project.worktree)
    if (filter === "recent") return isRecentVisible(state)
    if (filter === "archived") return state.archived
    return state.hidden
  })
}

export function sortClosedProjects<T extends LocalProject>(items: T[], sort: ClosedSort) {
  if (sort === "recent") return items
  const next = [...items]
  next.sort((a, b) => {
    const name = displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" })
    if (name !== 0) return sort === "name-asc" ? name : -name
    return pathKey(a.worktree) < pathKey(b.worktree) ? (sort === "name-asc" ? -1 : 1) : sort === "name-asc" ? 1 : -1
  })
  return next
}

export function filterAndSortClosedProjects<T extends LocalProject>(
  items: T[],
  states: Map<string, ClosedProjectState> | ((directory: string) => ClosedProjectState),
  options: { query: string; filter: ClosedFilter; sort: ClosedSort },
) {
  const byQuery = options.query.trim() ? items.filter((project) => matchesClosedQuery(project, options.query)) : items
  const byState = filterClosedByState(byQuery, states, options.filter)
  return sortClosedProjects(byState, options.sort)
}

export function countClosedStates<T extends LocalProject>(
  items: T[],
  states: Map<string, ClosedProjectState> | ((directory: string) => ClosedProjectState),
) {
  const get = typeof states === "function" ? states : (directory: string) => states.get(pathKey(directory)) ?? { hidden: false, archived: false }
  let recent = 0
  let archived = 0
  let hidden = 0
  for (const project of items) {
    const state = get(project.worktree)
    if (state.hidden) hidden += 1
    if (state.archived) archived += 1
    if (isRecentVisible(state)) recent += 1
  }
  return { total: items.length, recent, archived, hidden }
}

export function buildClosedStateMap(
  items: LocalProject[],
  isHidden: (directory: string) => boolean,
  isArchived: (directory: string) => boolean,
) {
  const map = new Map<string, ClosedProjectState>()
  for (const project of items) {
    map.set(pathKey(project.worktree), { hidden: isHidden(project.worktree), archived: isArchived(project.worktree) })
  }
  return map
}
