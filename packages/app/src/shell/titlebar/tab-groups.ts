import { Effect, Option, Schema } from "effect"
import { arrayMove } from "@/runtime/array-move"
import { Persistence } from "@/runtime/persistence/schema"
import type { ServerConnection } from "@/runtime/server/registry"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import type { SidebarStatus } from "./sidebar-view"

export const TAB_GROUP_MODES = ["none", "server", "project", "status"] as const

export type TabGroupMode = (typeof TAB_GROUP_MODES)[number]

export const TAB_GROUP_COLORS = ["blue", "green", "orange", "purple", "pink", "cyan", "gray"] as const

export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number]

export const AUTO_TAB_GROUP_COLORS = ["blue", "green", "orange", "purple", "cyan", "pink"] as const

export const ManualTabGroupSchema = Persistence.struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.Literals(TAB_GROUP_COLORS),
})

export type ManualTabGroup = typeof ManualTabGroupSchema.Type

export const TabGroupOverrideSchema = Persistence.struct({
  name: Persistence.optional(Schema.String),
  color: Persistence.optional(Schema.Literals(TAB_GROUP_COLORS)),
})

export type TabGroupOverride = typeof TabGroupOverrideSchema.Type

export const TabGroupsStateSchema = Persistence.struct({
  mode: Schema.Literals(TAB_GROUP_MODES).pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some("none" as const))),
  ),
  groupOrder: Persistence.optional(Persistence.array(Schema.String)),
  collapsed: Persistence.record(Schema.Boolean),
  overrides: Persistence.record(TabGroupOverrideSchema),
  manualGroups: Persistence.array(ManualTabGroupSchema),
  manualAssignments: Persistence.record(Schema.String),
})

export type TabGroupsState = typeof TabGroupsStateSchema.Type

export const DEFAULT_TAB_GROUPS_STATE: TabGroupsState = {
  mode: "server",
  groupOrder: [],
  collapsed: {},
  overrides: {},
  manualGroups: [],
  manualAssignments: {},
}

export type ResolvedTabMeta = {
  tab: Tab
  key: string
  title: string
  server: ServerConnection.Key
  serverLabel: string
  projectID: string | undefined
  projectName: string | undefined
  directory: string | undefined
  status: SidebarStatus
  active: boolean
}

export type ComputedTabGroup = {
  key: string
  kind: "ungrouped" | "manual" | "server" | "project" | "status"
  manualId?: string
  server?: ServerConnection.Key
  directory?: string
  defaultName: string
  name: string
  hasCustomOverride: boolean
  color: TabGroupColor
  collapsed: boolean
  allTabs: Tab[]
  visibleTabs: Tab[]
  containsActive: boolean
}

const STATUS_COLOR: Record<SidebarStatus, TabGroupColor> = {
  input: "orange",
  running: "blue",
  unread: "purple",
  failed: "pink",
  idle: "gray",
}

const STATUS_ORDER: readonly SidebarStatus[] = ["input", "running", "unread", "failed", "idle"]

export function hashGroupColor(seed: string, usedColors: Set<TabGroupColor>): TabGroupColor {
  let hash = 0

  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }

  const candidates = AUTO_TAB_GROUP_COLORS.filter((color) => !usedColors.has(color))
  const pool = candidates.length > 0 ? candidates : AUTO_TAB_GROUP_COLORS

  return pool[Math.abs(hash) % pool.length] ?? "blue"
}

export function nextManualGroupColor(existing: readonly ManualTabGroup[]): TabGroupColor {
  const used = new Set(existing.map((group) => group.color))

  return AUTO_TAB_GROUP_COLORS.find((color) => !used.has(color)) ?? AUTO_TAB_GROUP_COLORS[existing.length % 6] ?? "blue"
}

export function matchesTabFilter(meta: ResolvedTabMeta, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase()

  if (!query) return true

  return (
    meta.title.toLocaleLowerCase().includes(query) ||
    meta.serverLabel.toLocaleLowerCase().includes(query) ||
    (meta.projectName?.toLocaleLowerCase().includes(query) ?? false) ||
    (meta.directory?.toLocaleLowerCase().includes(query) ?? false)
  )
}

function applySavedGroupOrder(groups: ComputedTabGroup[], savedOrder: readonly string[] | undefined) {
  if (!savedOrder?.length) return groups
  const rank = new Map(savedOrder.map((key, index) => [key, index]))

  return groups
    .map((group, index) => ({ group, rank: rank.get(group.key), index }))
    .toSorted((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank

      if (a.rank !== undefined) return -1

      if (b.rank !== undefined) return 1

      return a.index - b.index
    })
    .map((entry) => entry.group)
}

export function reorderTabKeysByGroups(
  allTabs: readonly Tab[],
  groups: readonly ComputedTabGroup[],
  fromIndex: number,
  toIndex: number,
) {
  const movedGroups = arrayMove([...groups], fromIndex, toIndex)
  const orderedGroupTabKeys = movedGroups.flatMap((group) => group.allTabs.map(tabKey))
  const inMoved = new Set(orderedGroupTabKeys)

  const untouched = allTabs.flatMap((tab) => {
    const key = tabKey(tab)

    return inMoved.has(key) ? [] : [key]
  })

  return {
    groupKeys: movedGroups.flatMap((group) => (group.kind !== "ungrouped" ? [group.key] : [])),
    tabKeys: [...orderedGroupTabKeys, ...untouched],
  }
}

export function reconcileManualAssignments(
  previousKeys: readonly string[],
  nextKeys: readonly string[],
  assignments: Readonly<Record<string, string>>,
): Record<string, string> | undefined {
  const assignedKeys = Object.keys(assignments)

  if (assignedKeys.length === 0 || nextKeys.length === 0) return undefined

  const nextSet = new Set(nextKeys)
  const prevSet = new Set(previousKeys)
  const updated = { ...assignments }
  let changed = false

  // Migrate manual group membership when a draft tab promotes in-place to a session tab.
  if (previousKeys.length === nextKeys.length) {
    previousKeys.forEach((prevKey, index) => {
      const nextKey = nextKeys[index]

      if (!nextKey || prevKey === nextKey || !prevKey.startsWith("draft:") || prevSet.has(nextKey)) return
      const groupId = updated[prevKey]

      if (!groupId) return
      updated[nextKey] = groupId
      delete updated[prevKey]
      changed = true
    })
  }

  // Prune assignments for tabs that are no longer open.
  Object.keys(updated).forEach((key) => {
    if (nextSet.has(key)) return
    delete updated[key]
    changed = true
  })

  return changed ? updated : undefined
}

export function buildComputedTabGroups(input: {
  items: readonly ResolvedTabMeta[]
  state: TabGroupsState
  mode: TabGroupMode
  serverCount: number
  query: string
  labels: {
    other: string
    status: (status: SidebarStatus) => string
  }
}): ComputedTabGroup[] | undefined {
  const searching = input.query.trim().length > 0
  const filtered = searching ? input.items.filter((item) => matchesTabFilter(item, input.query)) : input.items
  const effectiveMode = input.mode === "server" && input.serverCount <= 1 ? "none" : input.mode

  // Automatic grouping is Off ("none"): flat tabs unless the user has manual groups or an active filter query.
  if (effectiveMode === "none") {
    if (input.state.manualGroups.length > 0) {
      return buildManualGroups(filtered, input.state, searching)
    }

    if (!searching) return undefined

    return [
      {
        key: "ungrouped:search",
        kind: "ungrouped",
        defaultName: "",
        name: "",
        hasCustomOverride: false,
        color: "gray",
        collapsed: false,
        allTabs: filtered.map((item) => item.tab),
        visibleTabs: filtered.map((item) => item.tab),
        containsActive: filtered.some((item) => item.active),
      },
    ]
  }

  const usedColors = new Set<TabGroupColor>()

  if (effectiveMode === "server") {
    const buckets = [...Map.groupBy(filtered, (item) => item.server)]

    const groups = buckets.map(([server, rows]): ComputedTabGroup => {
      const key = `server:${server}`
      const defaultName = rows[0]?.serverLabel ?? server
      const override = input.state.overrides[key]
      const color = override?.color ?? hashGroupColor(server, usedColors)
      usedColors.add(color)
      const collapsed = searching ? false : !!input.state.collapsed[key]
      const allTabs = rows.map((row) => row.tab)

      return {
        key,
        kind: "server",
        server,
        directory: rows[0]?.directory,
        defaultName,
        name: override?.name?.trim() || defaultName,
        hasCustomOverride: !!(override?.name?.trim() || override?.color),
        color,
        collapsed,
        allTabs,
        visibleTabs: collapsed ? [] : allTabs,
        containsActive: rows.some((row) => row.active),
      }
    })

    return applySavedGroupOrder(groups, input.state.groupOrder)
  }

  if (effectiveMode === "project") {
    const buckets = [...Map.groupBy(filtered, (item) => item.projectID ?? item.directory ?? "other")]

    const groups = buckets.map(([projectKey, rows]): ComputedTabGroup => {
      const key = `project:${projectKey}`
      const defaultName = rows[0]?.projectName ?? input.labels.other
      const override = input.state.overrides[key]
      const color = override?.color ?? (projectKey === "other" ? "gray" : hashGroupColor(projectKey, usedColors))
      usedColors.add(color)
      const collapsed = searching ? false : !!input.state.collapsed[key]
      const allTabs = rows.map((row) => row.tab)

      return {
        key,
        kind: "project",
        server: rows[0]?.server,
        directory: rows[0]?.directory,
        defaultName,
        name: override?.name?.trim() || defaultName,
        hasCustomOverride: !!(override?.name?.trim() || override?.color),
        color,
        collapsed,
        allTabs,
        visibleTabs: collapsed ? [] : allTabs,
        containsActive: rows.some((row) => row.active),
      }
    })

    return applySavedGroupOrder(groups, input.state.groupOrder)
  }

  const byStatus = Map.groupBy(filtered, (item) => item.status)

  const groups = STATUS_ORDER.flatMap((status): ComputedTabGroup[] => {
    const rows = byStatus.get(status)

    if (!rows?.length) return []
    const key = `status:${status}`
    const defaultName = input.labels.status(status)
    const override = input.state.overrides[key]
    const color = override?.color ?? STATUS_COLOR[status]
    const collapsed = searching ? false : !!input.state.collapsed[key]
    const allTabs = rows.map((row) => row.tab)

    return [
      {
        key,
        kind: "status",
        server: rows[0]?.server,
        directory: rows[0]?.directory,
        defaultName,
        name: override?.name?.trim() || defaultName,
        hasCustomOverride: !!(override?.name?.trim() || override?.color),
        color,
        collapsed,
        allTabs,
        visibleTabs: collapsed ? [] : allTabs,
        containsActive: rows.some((row) => row.active),
      },
    ]
  })

  return applySavedGroupOrder(groups, input.state.groupOrder)
}

function buildManualGroups(
  items: readonly ResolvedTabMeta[],
  state: TabGroupsState,
  searching: boolean,
): ComputedTabGroup[] {
  const groupsById = new Map(state.manualGroups.map((group) => [group.id, group]))
  const groupedItems = new Map<string, ResolvedTabMeta[]>()

  items.forEach((item) => {
    const groupId = state.manualAssignments[item.key]

    if (!groupId || !groupsById.has(groupId)) return
    const list = groupedItems.get(groupId)

    if (list) {
      list.push(item)

      return
    }

    groupedItems.set(groupId, [item])
  })

  const emittedGroups = new Set<string>()
  const out: ComputedTabGroup[] = []
  let ungroupedRun: ResolvedTabMeta[] = []
  let ungroupedIndex = 0

  const flushUngrouped = () => {
    if (!ungroupedRun.length) return
    const batch = ungroupedRun
    ungroupedRun = []
    const allTabs = batch.map((row) => row.tab)
    out.push({
      key: `ungrouped:${ungroupedIndex++}`,
      kind: "ungrouped",
      defaultName: "",
      name: "",
      hasCustomOverride: false,
      color: "gray",
      collapsed: false,
      allTabs,
      visibleTabs: allTabs,
      containsActive: batch.some((row) => row.active),
    })
  }

  items.forEach((item) => {
    const groupId = state.manualAssignments[item.key]
    const manual = groupId ? groupsById.get(groupId) : undefined

    if (!manual) {
      ungroupedRun.push(item)

      return
    }

    if (emittedGroups.has(manual.id)) return
    flushUngrouped()
    emittedGroups.add(manual.id)
    const rows = groupedItems.get(manual.id) ?? []
    const key = `manual:${manual.id}`
    const collapsed = searching ? false : !!state.collapsed[key]
    const allTabs = rows.map((row) => row.tab)
    out.push({
      key,
      kind: "manual",
      manualId: manual.id,
      server: rows[0]?.server,
      directory: rows[0]?.directory,
      defaultName: manual.name,
      name: manual.name,
      hasCustomOverride: false,
      color: manual.color,
      collapsed,
      allTabs,
      visibleTabs: collapsed ? [] : allTabs,
      containsActive: rows.some((row) => row.active),
    })
  })

  flushUngrouped()

  if (!searching) {
    state.manualGroups.forEach((manual) => {
      if (emittedGroups.has(manual.id)) return
      const key = `manual:${manual.id}`
      out.push({
        key,
        kind: "manual",
        manualId: manual.id,
        defaultName: manual.name,
        name: manual.name,
        hasCustomOverride: false,
        color: manual.color,
        collapsed: !!state.collapsed[key],
        allTabs: [],
        visibleTabs: [],
        containsActive: false,
      })
    })
  }

  return out
}
