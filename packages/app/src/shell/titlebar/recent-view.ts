import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"

export const RECENT_GROUP_BYS = ["date", "status", "project", "server"] as const

export const RECENT_SORT_BYS = ["updated", "created", "name"] as const

export const RECENT_DIRECTIONS = ["desc", "asc"] as const

/** The order Status lists its groups in: what needs you first, then what's running, then what you haven't read. */
export const RECENT_STATUSES = ["attention", "working", "unread", "read"] as const

export const RECENT_DATES = ["today", "yesterday", "week", "older"] as const

export type RecentGroupBy = (typeof RECENT_GROUP_BYS)[number] | "none"

export type RecentSortBy = (typeof RECENT_SORT_BYS)[number]

export type RecentDirection = (typeof RECENT_DIRECTIONS)[number]

export type RecentStatus = (typeof RECENT_STATUSES)[number]

export type RecentDate = (typeof RECENT_DATES)[number]

export const RecentViewState = Persistence.struct({
  groupBy: Schema.Literals(["none", ...RECENT_GROUP_BYS]),
  sortBy: Schema.Literals(RECENT_SORT_BYS),
  direction: Schema.Literals(RECENT_DIRECTIONS),
  metadata: Schema.Boolean,
  emptyGroups: Schema.Boolean,
  /** Collapsed group IDs, as `${groupBy}:${group id}`, so each grouping remembers its own. */
  collapsed: Persistence.array(Schema.String),
})

export type RecentView = (typeof RecentViewState)["Type"]

export const DEFAULT_RECENT_VIEW: RecentView = {
  groupBy: "none",
  sortBy: "updated",
  direction: "desc",
  metadata: false,
  emptyGroups: false,
  collapsed: [],
}

export type RecentViewRow = {
  key: string
  title: string
  updated: number
  created: number
  status: RecentStatus
  /** `undefined` for a session outside any known project. */
  project: { key: string; label: string } | undefined
  server: string
}

export type RecentGroup<R extends RecentViewRow> = {
  key: string
  id: string
  /** The project or server name; date and status groups take their label from their ID. */
  label: string | undefined
  rows: R[]
}

/**
 * Sorts and groups Recent's rows. Date groups follow the sort direction; Status groups keep their fixed order, Project
 * groups go A to Z with sessions outside a project last, and Server groups follow `servers`. Empty groups only show for
 * the fixed sets (date, status, server) and only when asked for.
 */
export function recentGroups<R extends RecentViewRow>(
  rows: readonly R[],
  view: RecentView,
  context: { now: number; servers: readonly { key: string; label: string }[] },
): RecentGroup<R>[] {
  const sorted = rows.toSorted(comparator(view))

  if (view.groupBy === "none") return [{ key: "none:all", id: "all", label: undefined, rows: sorted }]

  if (view.groupBy === "date") {
    const bucket = dateBucket(context.now)
    const time = (row: R) => (view.sortBy === "created" ? row.created : row.updated)
    const ids = view.direction === "asc" ? RECENT_DATES.toReversed() : RECENT_DATES

    return fixed(
      view,
      ids.map((id) => ({ id, label: undefined })),
      sorted,
      (row) => bucket(time(row)),
    )
  }

  if (view.groupBy === "status")
    return fixed(
      view,
      RECENT_STATUSES.map((id) => ({ id, label: undefined })),
      sorted,
      (row) => row.status,
    )

  if (view.groupBy === "server")
    return fixed(
      view,
      context.servers.map((server) => ({ id: server.key, label: server.label })),
      sorted,
      (row) => row.server,
    )

  const projects = new Map<string, { id: string; label: string | undefined }>()

  sorted.forEach((row) => {
    const id = row.project?.key ?? NO_PROJECT

    if (!projects.has(id)) projects.set(id, { id, label: row.project?.label })
  })

  const order = [...projects.values()].toSorted((a, b) => {
    if (a.id === NO_PROJECT) return 1

    if (b.id === NO_PROJECT) return -1

    return (a.label ?? "").localeCompare(b.label ?? "", undefined, { numeric: true, sensitivity: "base" })
  })

  return fixed({ ...view, emptyGroups: false }, order, sorted, (row) => row.project?.key ?? NO_PROJECT)
}

export const NO_PROJECT = "none"

function fixed<R extends RecentViewRow>(
  view: RecentView,
  groups: readonly { id: string; label: string | undefined }[],
  rows: readonly R[],
  groupOf: (row: R) => string,
): RecentGroup<R>[] {
  const byGroup = Map.groupBy(rows, groupOf)

  return groups.flatMap((group) => {
    const members = byGroup.get(group.id) ?? []

    if (members.length === 0 && !view.emptyGroups) return []

    return [{ key: `${view.groupBy}:${group.id}`, id: group.id, label: group.label, rows: members }]
  })
}

function comparator(view: RecentView) {
  const sign = view.direction === "asc" ? -1 : 1

  return (a: RecentViewRow, b: RecentViewRow) => {
    const primary = difference(view.sortBy, a, b)

    if (primary !== 0) return sign * primary

    if (a.updated !== b.updated) return b.updated - a.updated

    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  }
}

function difference(sortBy: RecentSortBy, a: RecentViewRow, b: RecentViewRow) {
  if (sortBy === "name") return b.title.localeCompare(a.title, undefined, { numeric: true, sensitivity: "base" })

  if (sortBy === "created") return b.created - a.created

  return b.updated - a.updated
}

function dateBucket(now: number) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const start = today.getTime()
  const day = (offset: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset).getTime()

  return (time: number): RecentDate => {
    if (time >= start) return "today"

    if (time >= day(1)) return "yesterday"

    if (time >= day(7)) return "week"

    return "older"
  }
}
