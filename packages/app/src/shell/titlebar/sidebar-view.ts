export type SidebarGrouping = "none" | "project" | "server-project" | "server"

export type SidebarOrdering = "manual" | "updated" | "created" | "attention"

export type SidebarStatus = "input" | "failed" | "unread" | "running" | "idle"

export type SidebarShow = { recent: boolean; subagents: boolean; serverLabels: boolean }

export type SidebarShowKey = keyof SidebarShow

/** A `project` value of "none" matches rows without a project. */
export type SidebarFilters = { status: SidebarStatus[]; server: string[]; project: string[] }

export type SidebarFilterKind = keyof SidebarFilters

export type SidebarViewState = {
  grouping: SidebarGrouping
  ordering: SidebarOrdering
  show: SidebarShow
  filters: SidebarFilters
  collapsed: Record<string, boolean>
}

export type SidebarRow = {
  key: string
  server: string
  projectID: string | undefined
  /** An open tab, as opposed to a recent or subagent session. */
  open: boolean
  active: boolean
  /** The row key of the parent session, for subagent rows. */
  parentKey: string | undefined
  status: SidebarStatus
  updated: number
  created: number
  /** Position in the saved tab order, for open rows. */
  order: number
}

export type SidebarGroup<R extends SidebarRow> = {
  key: string
  kind: "all" | "project" | "server"
  /** The project ID, "other", the server key, or "all". */
  id: string
  /** The server of a server group, or of a project group nested in one. */
  server: string | undefined
  collapsed: boolean
  /** Open top-level rows in the group, including nested groups. */
  open: number
  /** Leaf groups: sorted rows, subagents right after their parent. Server → Project parents: empty. */
  rows: R[]
  /** A project group whose rows come from more than one server. */
  spansServers: boolean
  children: SidebarGroup<R>[] | undefined
}

export type SidebarView<R extends SidebarRow> = {
  groups: SidebarGroup<R>[]
}

export const SIDEBAR_STATUSES: readonly SidebarStatus[] = ["running", "input", "unread", "failed", "idle"]

export const SIDEBAR_GROUPINGS: readonly SidebarGrouping[] = ["none", "project", "server-project", "server"]

export const SIDEBAR_ORDERINGS: readonly SidebarOrdering[] = ["manual", "updated", "created", "attention"]

export const SIDEBAR_SHOW_KEYS: readonly SidebarShowKey[] = ["recent", "subagents", "serverLabels"]

export function sidebarView<R extends SidebarRow>(rows: readonly R[], state: SidebarViewState): SidebarView<R> {
  const kept = keptRows(rows, state)
  const keys = new Set(kept.map((row) => row.key))

  const children = Map.groupBy(
    kept.filter((row) => row.parentKey !== undefined && keys.has(row.parentKey)),
    (row) => row.parentKey,
  )

  const compare = comparator(state.ordering)

  const top = kept
    .filter((row) => row.parentKey === undefined || !keys.has(row.parentKey))
    .toSorted((a, b) => Number(b.open) - Number(a.open) || compare(a, b) || byKey(a, b))

  const withChildren = (row: R): R[] => [
    row,
    ...(children.get(row.key) ?? []).toSorted((a, b) => b.updated - a.updated || byKey(a, b)).flatMap(withChildren),
  ]

  return { groups: buildGroups(top, withChildren, state) }
}

const ATTENTION: Record<SidebarStatus, number> = { input: 0, failed: 1, unread: 2, running: 3, idle: 4 }

function keptRows<R extends SidebarRow>(rows: readonly R[], state: SidebarViewState) {
  const visible = rows.filter((row) => row.active || isVisible(row, state))
  const byKey = new Map(visible.map((row) => [row.key, row]))

  const attached = (row: R): boolean => {
    if (row.active || row.parentKey === undefined) return true
    const parent = byKey.get(row.parentKey)

    return parent !== undefined && attached(parent)
  }

  return visible.filter(attached)
}

function isVisible(row: SidebarRow, state: SidebarViewState) {
  if (row.parentKey !== undefined && !state.show.subagents) return false

  if (!row.open && row.parentKey === undefined && !state.show.recent) return false
  const filters = state.filters

  if (filters.status.length > 0 && !filters.status.includes(row.status)) return false

  if (filters.server.length > 0 && !filters.server.includes(row.server)) return false

  return filters.project.length === 0 || filters.project.includes(row.projectID ?? "none")
}

function comparator(ordering: SidebarOrdering): (a: SidebarRow, b: SidebarRow) => number {
  if (ordering === "manual") return (a, b) => (a.open && b.open ? a.order - b.order : b.updated - a.updated)

  if (ordering === "created") return (a, b) => b.created - a.created

  if (ordering === "attention") return (a, b) => ATTENTION[a.status] - ATTENTION[b.status] || b.updated - a.updated

  return (a, b) => b.updated - a.updated
}

function byKey(a: SidebarRow, b: SidebarRow) {
  if (a.key === b.key) return 0

  return a.key < b.key ? -1 : 1
}

type Bucket<R> = {
  key: string
  kind: SidebarGroup<SidebarRow>["kind"]
  id: string
  server: string | undefined
  rows: R[]
}

function buildGroups<R extends SidebarRow>(top: R[], withChildren: (row: R) => R[], state: SidebarViewState) {
  const collapsed = state.collapsed

  if (state.grouping === "none") {
    return [leaf({ key: "all", kind: "all", id: "all", server: undefined, rows: top }, withChildren, collapsed)]
  }

  if (state.grouping === "project") {
    return projectBuckets(top, "", undefined).map((bucket) => leaf(bucket, withChildren, collapsed))
  }

  const servers = [...Map.groupBy(top, (row) => row.server)]

  if (state.grouping === "server") {
    return servers.map(([server, rows]) =>
      leaf({ key: `server:${server}`, kind: "server", id: server, server, rows }, withChildren, collapsed),
    )
  }

  return servers.map(([server, rows]): SidebarGroup<R> => {
    const key = `server:${server}`
    const nested = projectBuckets(rows, `${key}/`, server).map((bucket) => leaf(bucket, withChildren, collapsed))

    return {
      key,
      kind: "server",
      id: server,
      server,
      collapsed: !!collapsed[key],
      open: nested.reduce((sum, group) => sum + group.open, 0),
      rows: [],
      spansServers: false,
      children: nested,
    }
  })
}

/** Project buckets in first-row order, with rows lacking a project in a trailing "other" bucket. */
function projectBuckets<R extends SidebarRow>(rows: R[], prefix: string, server: string | undefined): Bucket<R>[] {
  return [...Map.groupBy(rows, (row) => row.projectID)]
    .toSorted(([a], [b]) => Number(a === undefined) - Number(b === undefined))
    .map(([projectID, rows]) => {
      const id = projectID ?? "other"

      return { key: `${prefix}project:${id}`, kind: "project", id, server, rows }
    })
}

function leaf<R extends SidebarRow>(
  bucket: Bucket<R>,
  withChildren: (row: R) => R[],
  collapsed: Record<string, boolean>,
): SidebarGroup<R> {
  const rows = bucket.rows.flatMap(withChildren)

  return {
    ...bucket,
    rows,
    collapsed: !!collapsed[bucket.key],
    open: bucket.rows.filter((row) => row.open).length,
    spansServers: bucket.kind === "project" && new Set(rows.map((row) => row.server)).size > 1,
    children: undefined,
  }
}
