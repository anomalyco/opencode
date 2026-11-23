import { Effect, Option, Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import type { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"

export const TAB_GROUP_MODES = ["none", "server", "project"] as const

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
  colors: Persistence.optional(Persistence.record(Schema.Literals(TAB_GROUP_COLORS))),
})

export type TabGroupsState = typeof TabGroupsStateSchema.Type

export const DEFAULT_TAB_GROUPS_STATE: TabGroupsState = {
  mode: "server",
  groupOrder: [],
  collapsed: {},
  overrides: {},
  manualGroups: [],
  manualAssignments: {},
  colors: {},
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
  active: boolean
}

export type ComputedTabGroup = {
  key: string
  kind: "ungrouped" | "manual" | "server" | "project"
  manualId?: string
  server?: ServerConnection.Key
  directory?: string
  defaultName: string
  name: string
  hasCustomOverride: boolean
  color: TabGroupColor
  defaultColor: TabGroupColor
  collapsed: boolean
  allTabs: Tab[]
  visibleTabs: Tab[]
  containsActive: boolean
}

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

export function nextManualGroupNumber(
  existing: readonly ManualTabGroup[],
  formatName: (number: number) => string,
): number {
  const taken = new Set(existing.map((group) => group.name.trim().toLocaleLowerCase()))

  for (let n = 1; n <= existing.length + 1; n++) {
    if (!taken.has(formatName(n).trim().toLocaleLowerCase())) return n
  }

  return existing.length + 1
}

/**
 * Keeps the default color each group was first given (`remembered`), and picks one for a new group in sorted seed order,
 * avoiding colors the other present groups already use. Recoloring, reordering, filtering or closing one group never
 * changes another group's color.
 */
export function assignStableGroupColors(
  seeds: readonly string[],
  prefix: "server:" | "project:",
  remembered: Readonly<Record<string, TabGroupColor>>,
): Map<string, TabGroupColor> {
  const unique = [...new Set(seeds)].toSorted()
  const used = new Set(unique.flatMap((seed) => remembered[`${prefix}${seed}`] ?? []))
  const out = new Map<string, TabGroupColor>()

  unique.forEach((seed) => {
    if (prefix === "project:" && seed === "other") {
      out.set(seed, "gray")

      return
    }

    const saved = remembered[`${prefix}${seed}`]

    if (saved) {
      out.set(seed, saved)

      return
    }

    const picked = hashGroupColor(seed, used)
    used.add(picked)
    out.set(seed, picked)
  })

  return out
}

/**
 * Records the position and default color of each automatic group the first time it appears. Without this, group order
 * follows the first tab of each group in tab order and colors depend on which groups are open, so closing one tab could
 * reorder or recolor the groups that remain.
 */
export function rememberAutoGroups(groups: readonly ComputedTabGroup[] | undefined, state: TabGroupsState) {
  const auto = (groups ?? []).filter((group) => group.kind === "server" || group.kind === "project")
  const order = state.groupOrder ?? []
  const known = new Set(order)
  const added = auto.filter((group) => !known.has(group.key))
  const uncolored = auto.filter((group) => !state.colors?.[group.key])

  if (!added.length && !uncolored.length) return undefined

  return {
    groupOrder: [...order, ...added.map((group) => group.key)],
    colors: { ...state.colors, ...Object.fromEntries(uncolored.map((group) => [group.key, group.defaultColor])) },
  }
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

export function pruneEmptyManualGroups(
  manualGroups: readonly ManualTabGroup[],
  assignments: Readonly<Record<string, string>>,
): ManualTabGroup[] {
  const populated = new Set(Object.values(assignments))

  return manualGroups.filter((group) => populated.has(group.id))
}

/**
 * Ensures tabs sharing a manual group stay contiguous in `tabs.store` order so visual section order and backing store
 * order never diverge when tabs are inserted, promoted, or switched back from automatic grouping.
 */
export function canonicalizeManualTabOrder(
  keys: readonly string[],
  assignments: Readonly<Record<string, string>>,
  movedKey?: string,
): string[] {
  const byGroup = new Map<string, string[]>()

  keys.forEach((key) => {
    const gid = assignments[key]

    if (!gid) return
    const list = byGroup.get(gid)

    if (list) list.push(key)

    if (!list) byGroup.set(gid, [key])
  })

  const emitted = new Set<string>()
  const out: string[] = []
  const movedGroup = movedKey ? assignments[movedKey] : undefined

  keys.forEach((key) => {
    const gid = assignments[key]

    if (!gid) {
      out.push(key)

      return
    }

    if (emitted.has(gid)) return

    if (gid === movedGroup && key === movedKey) {
      emitted.add(gid)
      out.push(...(byGroup.get(gid) ?? []))

      return
    }

    emitted.add(gid)
    out.push(...(byGroup.get(gid) ?? []))
  })

  return out
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
  knownServers?: readonly ServerConnection.Key[]
  query: string
  labels: {
    other: string
  }
}): ComputedTabGroup[] | undefined {
  const searching = input.query.trim().length > 0
  const filtered = searching ? input.items.filter((item) => matchesTabFilter(item, input.query)) : input.items
  const effectiveMode = input.mode === "server" && input.serverCount <= 1 ? "none" : input.mode

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
        defaultColor: "gray",
        collapsed: false,
        allTabs: filtered.map((item) => item.tab),
        visibleTabs: filtered.map((item) => item.tab),
        containsActive: filtered.some((item) => item.active),
      },
    ]
  }

  if (effectiveMode === "server") {
    const colorMap = assignStableGroupColors(
      [...(input.knownServers ?? []), ...input.items.map((item) => item.server)],
      "server:",
      input.state.colors ?? {},
    )

    const buckets = [...Map.groupBy(filtered, (item) => item.server)]

    const groups = buckets.map(([server, rows]): ComputedTabGroup => {
      const key = `server:${server}`
      const defaultName = rows[0]?.serverLabel ?? server
      const override = input.state.overrides[key]
      const defaultColor = colorMap.get(server) ?? "blue"
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
        color: override?.color ?? defaultColor,
        defaultColor,
        collapsed,
        allTabs,
        visibleTabs: collapsed ? [] : allTabs,
        containsActive: rows.some((row) => row.active),
      }
    })

    return applySavedGroupOrder(groups, input.state.groupOrder)
  }

  const projectSeedOf = (item: ResolvedTabMeta) => item.projectID ?? item.directory ?? "other"

  const colorMap = assignStableGroupColors(input.items.map(projectSeedOf), "project:", input.state.colors ?? {})

  const buckets = [...Map.groupBy(filtered, projectSeedOf)]

  const groups = buckets.map(([projectKey, rows]): ComputedTabGroup => {
    const key = `project:${projectKey}`
    const defaultName = rows[0]?.projectName ?? input.labels.other
    const override = input.state.overrides[key]
    const defaultColor = colorMap.get(projectKey) ?? "gray"
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
      color: override?.color ?? defaultColor,
      defaultColor,
      collapsed,
      allTabs,
      visibleTabs: collapsed ? [] : allTabs,
      containsActive: rows.some((row) => row.active),
    }
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

  const flushUngrouped = () => {
    if (!ungroupedRun.length) return
    const batch = ungroupedRun
    ungroupedRun = []
    const allTabs = batch.map((row) => row.tab)
    out.push({
      key: `ungrouped:${batch[0]!.key}`,
      kind: "ungrouped",
      defaultName: "",
      name: "",
      hasCustomOverride: false,
      color: "gray",
      defaultColor: "gray",
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
      defaultColor: manual.color,
      collapsed,
      allTabs,
      visibleTabs: collapsed ? [] : allTabs,
      containsActive: rows.some((row) => row.active),
    })
  })

  flushUngrouped()

  return out
}
