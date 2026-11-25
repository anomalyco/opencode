import type { ServerConnection } from "@/runtime/server/registry"
import { tabKey, type Tab } from "@/shell/tabs/tabs"

export type TabGrouping = "none" | "project" | "server"

/** An open tab with what it groups by: its server, and its project on that server when it has one. */
export type AutoTabGroupItem = {
  tab: Tab
  server: ServerConnection.Key
  project: string | undefined
}

export type AutoTabGroup = {
  key: string
  /** "other" holds the tabs with no project, after every project, without a header. */
  kind: "project" | "server" | "other"
  server: ServerConnection.Key | undefined
  project: string | undefined
  /** In project grouping, the same project also has a group on another server. */
  spansServers: boolean
  collapsed: boolean
  /** Every tab in the group, in order. */
  allTabs: Tab[]
  /** The tabs shown: all of the group's, or only the current one while it is collapsed. */
  tabs: Tab[]
}

const OTHER = "other"

/**
 * Open tabs grouped by project or server, in the order each group's first tab appears. Returns undefined when nothing
 * groups them: grouping is off, or it is by server and there is only one.
 */
export function autoTabGroups(input: {
  grouping: TabGrouping
  servers: number
  items: readonly AutoTabGroupItem[]
  collapsed: Readonly<Record<string, boolean>>
  current: Tab | undefined
}): AutoTabGroup[] | undefined {
  if (input.grouping === "none" || (input.grouping === "server" && input.servers < 2)) return
  const grouping = input.grouping
  const current = input.current ? tabKey(input.current) : undefined

  const buckets = [
    ...Map.groupBy(input.items, (item) => {
      if (grouping === "server") return `server:${item.server}`

      return item.project === undefined ? OTHER : `project:${item.server}\u0000${item.project}`
    }),
  ]

  const projectServers = Map.groupBy(
    buckets.flatMap(([key, rows]) => (key === OTHER ? [] : [rows[0]])),
    (item) => item.project,
  )

  return [...buckets.filter(([key]) => key !== OTHER), ...buckets.filter(([key]) => key === OTHER)].map(
    ([key, rows]): AutoTabGroup => {
      const kind = key === OTHER ? "other" : grouping
      const collapsed = kind !== "other" && !!input.collapsed[key]
      const tabs = rows.map((row) => row.tab)

      return {
        key,
        kind,
        server: kind === "other" ? undefined : rows[0].server,
        project: kind === "project" ? rows[0].project : undefined,
        spansServers: kind === "project" && (projectServers.get(rows[0].project)?.length ?? 0) > 1,
        collapsed,
        allTabs: tabs,
        tabs: collapsed ? tabs.filter((tab) => tabKey(tab) === current) : tabs,
      }
    },
  )
}

/**
 * The saved tab order with each group's tabs together, groups in the order they first appear. Tabs outside every group
 * (pinned, or with no project yet) keep their places, so a project that loads late joins its group where it was.
 */
export function groupedTabOrder(order: readonly string[], groups: readonly AutoTabGroup[]) {
  const grouped = groups.flatMap((group) => (group.kind === "other" ? [] : group.allTabs.map(tabKey)))
  const members = new Set(grouped)
  const next = grouped.values()

  return order.map((key) => (members.has(key) ? (next.next().value ?? key) : key))
}
