import { batch, createMemo, type Accessor } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import { createGroupAccessors } from "./groups"
import { HOT_ZONE_WIDTH, RAIL_COLLAPSED_WIDTH, RAIL_EXPANDED_WIDTH, createRailState } from "./rail"
import { createSplitActions } from "./split"
import { createTerminalState } from "./terminal"
import { createWorkspaceRecency } from "./workspace-recency"
import type { ClaxedoLayoutStore, TabItem } from "./types"

const WORKTREE_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#a855f7", // purple
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#6366f1", // indigo
  "#ef4444", // red
  "#06b6d4", // cyan
]

export function createClaxedoLayoutFacade(input: {
  store: ClaxedoLayoutStore
  setStore: SetStoreFunction<ClaxedoLayoutStore>
  ready: Accessor<boolean>
}) {
  const { store, setStore, ready } = input

  const focusedGroup = () => {
    const id = store.split.focusedId
    return store.groups.find((g) => g.id === id) ?? store.groups[0]
  }

  const rail = createRailState({ store, setStore })

  const findTabGroup = (tabId: string): string | undefined => {
    return store.groups.find((g) => g.tabs.items.some((t) => t.id === tabId))?.id
  }

  const patchTab = (tabId: string, patch: Partial<TabItem>) => {
    for (let i = 0; i < store.groups.length; i++) {
      if (store.groups[i].tabs.items.some((t) => t.id === tabId)) {
        setStore("groups", i, "tabs", "items", (items: TabItem[]) =>
          (items ?? []).map((t) => (t.id !== tabId ? t : { ...t, ...patch })),
        )
        return
      }
    }
  }

  const terminalState = createTerminalState({
    store,
    setStore,
    findTabGroup,
  })

  const { groupTabs, groupWorktree, groupLayout, topTabs, worktree } = createGroupAccessors({
    store,
    setStore,
    focusedGroup,
    clearTerminalTabState: terminalState.clearTerminalTabState,
  })

  const defaultForNewGroup = () => {
    const primary = store.groups[0]
    if (!primary) return null
    if (primary.worktree.default) return primary.worktree.default
    if (!primary.tabs.activeId) return null
    const active = primary.tabs.items.find((t) => t.id === primary.tabs.activeId)
    return active?.directory ?? null
  }

  const split = createSplitActions({
    store,
    setStore,
    clearTerminalTabState: terminalState.clearTerminalTabState,
    clearStaleCreatingState: terminalState.clearStaleCreatingState,
    defaultForNewGroup,
  })

  const workspaceRecency = createWorkspaceRecency({
    store,
    setStore,
  })

  const enabled = createMemo(() => store.enabled)
  const setEnabled = (value: boolean) => setStore("enabled", value)

  return {
    ready,
    enabled,
    setEnabled,
    rail,
    topTabs,
    worktree,
    groupTabs,
    groupWorktree,
    groupLayout,
    split,
    findTabGroup,
    patchTab,
    workspaceRecency,
    terminal: terminalState.terminal,

    getWorktreeColor(directory: string): string {
      // Return persisted color if already assigned
      const existing = store.worktreeColorMap[directory]
      if (existing) return existing

      // Find colors already in use
      const usedColors = new Set(Object.values(store.worktreeColorMap))

      // Pick the first unused color; fall back to hash if all are taken
      let color = WORKTREE_COLORS.find((c) => !usedColors.has(c))
      if (!color) {
        let hash = 0
        for (let i = 0; i < directory.length; i++) {
          const char = directory.charCodeAt(i)
          hash = (hash << 5) - hash + char
          hash = hash & hash
        }
        color = WORKTREE_COLORS[Math.abs(hash) % WORKTREE_COLORS.length]
      }

      // Persist assignment
      setStore("worktreeColorMap", directory, color)
      return color
    },

    getWorktreeName(directory: string): string {
      const parts = directory.split("/")
      return parts[parts.length - 1] || parts[parts.length - 2] || "unknown"
    },

    getTabGroupInfo(groupId: string): Array<{ directory: string; color: string; tabs: Array<TabItem & { isLastInGroup: boolean }> }> {
      const group = store.groups.find((g) => g.id === groupId)
      if (!group) return []

      const byDirectory = new Map<string, TabItem[]>()
      for (const tab of group.tabs.items) {
        const existing = byDirectory.get(tab.directory) || []
        existing.push(tab)
        byDirectory.set(tab.directory, existing)
      }

      const getWorktreeColor = this.getWorktreeColor
      return Array.from(byDirectory.entries()).map(([directory, tabs]) => ({
        directory,
        color: getWorktreeColor(directory),
        tabs: tabs.map((tab, index) => ({
          ...tab,
          isLastInGroup: index === tabs.length - 1,
        })),
      }))
    },

    canDragTabBetweenWorktrees(fromDir: string, toDir: string): boolean {
      return fromDir === toDir
    },

    getActiveWorktreeColor(groupId: string): string | undefined {
      const wt = groupWorktree(groupId)
      const activeDir = wt.pinned() || wt.default()
      if (!activeDir) return undefined
      return this.getWorktreeColor(activeDir)
    },

    /** Remove all traces of a deleted worktree from the store. */
    cleanupDeletedWorktree(directory: string, projectId?: string) {
      batch(() => {
        for (let gi = 0; gi < store.groups.length; gi++) {
          const group = store.groups[gi]

          // Remove tabs from the deleted directory
          const remaining = group.tabs.items.filter((t) => t.directory !== directory)
          if (remaining.length !== group.tabs.items.length) {
            const removedIds = new Set(
              group.tabs.items.filter((t) => t.directory === directory).map((t) => t.id),
            )
            const order = group.tabs.order.filter((id) => !removedIds.has(id))
            const closedTabs = group.tabs.closedTabs.filter((t) => t.directory !== directory)

            // Pick new active if current was removed
            let activeId = group.tabs.activeId
            if (activeId && removedIds.has(activeId)) {
              activeId = remaining.length > 0 ? remaining[0].id : null
            }

            setStore("groups", gi, "tabs", "items", remaining)
            setStore("groups", gi, "tabs", "order", order)
            setStore("groups", gi, "tabs", "closedTabs", closedTabs)
            setStore("groups", gi, "tabs", "activeId", activeId)
          }

          // Clear worktree default/pinned if they pointed to the deleted directory
          if (group.worktree.default === directory) {
            setStore("groups", gi, "worktree", "default", null)
          }
          if (group.worktree.pinned === directory) {
            setStore("groups", gi, "worktree", "pinned", null)
          }
        }

        // Clean up recency
        if (projectId) {
          const current = store.workspaceRecency[projectId] ?? []
          const cleaned = current.filter((dir) => dir !== directory)
          if (cleaned.length !== current.length) {
            setStore("workspaceRecency", projectId, cleaned)
          }
        }

        // Free the color assignment so it can be reused
        if (store.worktreeColorMap[directory]) {
          setStore("worktreeColorMap", directory, undefined)
        }
      })
    },

    constants: {
      RAIL_COLLAPSED_WIDTH,
      RAIL_EXPANDED_WIDTH,
      HOT_ZONE_WIDTH,
    },
  }
}
