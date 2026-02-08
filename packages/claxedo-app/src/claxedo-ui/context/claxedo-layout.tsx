/**
 * Claxedo Layout Context Extension
 *
 * Extends upstream layout.tsx with rail-specific state for the new UI architecture.
 * This file is Claxedo-specific and does not modify upstream files.
 */

import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Persist, persisted } from "@opencode-ai/claxedo-app"

export type TabType = "session" | "terminal" | "review" | "file"

export type TabItem = {
  id: string
  type: TabType
  directory: string
  title: string
  sessionId?: string // For session/review tabs
  terminalId?: string // For terminal tabs
  filePath?: string // For file tabs
  badge?: {
    additions: number
    deletions: number
  }
  closable: boolean
  pinned?: boolean
  loading?: boolean // Show loading indicator (spinning square)
  attention?: boolean // Show attention indicator (red dot) for terminals
  done?: boolean // Show done indicator (green dot) after agent completes at least one turn
}

export type RailState = {
  collapsed: boolean
  hovered: boolean
  pinned: boolean
  locked: boolean // Prevents collapse when dropdown is open
}

export type TopTabsState = {
  items: TabItem[]
  activeId: string | null
  order: string[]
  closedTabs: TabItem[] // For Cmd+Shift+T reopen
}

export type WorktreeState = {
  default: string | null
  pinned: string | null
}

export type PaneDir = "h" | "v"

export type Pane =
  | { t: "leaf"; id: string }
  | { t: "split"; dir: PaneDir; a: Pane; b: Pane; size: number }

/**
 * Agent status for a terminal
 * - idle: No agent running
 * - working: Agent is processing (shows amber spinner)
 * - permission: Agent needs user input (shows red dot)
 */
export type TerminalAgentStatus = "idle" | "working" | "permission"

export type GroupLayoutState = {
  fileTree: { opened: boolean; width: number; tab: "changes" | "all" }
  session: { width: number; collapsed: boolean; panelMode: number }
  reviewPanel: { opened: boolean }
}

const defaultGroupLayout = (): GroupLayoutState => ({
  fileTree: { opened: true, width: 344, tab: "changes" },
  session: { width: 600, collapsed: false, panelMode: 0 },
  reviewPanel: { opened: false },
})

export type GroupState = {
  id: string
  tabs: TopTabsState
  worktree: WorktreeState
  layout: GroupLayoutState
}

export type SplitState = {
  direction: "h" | "v"
  sizes: number[] // One per group, sums to 1.0
  focusedId: string
  hidden?: boolean // Split exists but is collapsed (toggle hides/shows)
}

type ClaxedoLayoutStore = {
  rail: RailState
  groups: GroupState[] // Length 1 = no split, 2 = split
  split: SplitState
  enabled: boolean // Feature flag

  // Terminal panes are keyed by terminal tab id (NOT PTY id) so we can safely
  // promote/detach panes without rewriting tab identity.
  terminalPane: Record<string, Pane | undefined>
  terminalFocus: Record<string, string | undefined>
  terminalZoom: Record<string, string | undefined>
  // PTY id -> terminal tab id (owned panes should not create their own top tab).
  terminalOwner: Record<string, string | undefined>
  // PTY id -> agent status (for tracking per-terminal agent state)
  terminalAgentStatus: Record<string, TerminalAgentStatus | undefined>
  // PTY id -> has ever been active (used to avoid showing "done" for terminals that never ran an agent)
  terminalAgentSeen: Record<string, true | undefined>

  // Workspace recency tracking: projectId -> workspace dirs (most recent first)
  // Used to show last 5 workspaces in WorkspaceBar when project has >5 workspaces
  workspaceRecency: Record<string, string[]>
}

// Default empty tabs state - only used for initial creation, not as reactive fallback
const createEmptyTabsState = (): TopTabsState => ({
  items: [],
  activeId: null,
  order: [],
  closedTabs: [],
})

const RAIL_COLLAPSED_WIDTH = 56
const RAIL_EXPANDED_WIDTH = 260
const HOT_ZONE_WIDTH = 12
const EXPAND_DELAY_MS = 100
const COLLAPSE_DELAY_MS = 100
const MAX_CLOSED_TABS = 10

function createTabActions(
  getItems: () => TabItem[],
  getActiveId: () => string | null,
  getOrder: () => string[],
  getClosedTabs: () => TabItem[],
  setItems: (fn: (items: TabItem[]) => TabItem[]) => void,
  setActiveId: (id: string | null) => void,
  setOrder: (fn: (order: string[]) => string[]) => void,
  setClosedTabs: (fn: (tabs: TabItem[]) => TabItem[]) => void,
  produceAll: (fn: (draft: TopTabsState) => void) => void,
  onClose?: (tab: TabItem) => void,
) {
  const tabActions = {
    items: (() => getItems()) as Accessor<TabItem[]>,
    activeId: (() => getActiveId()) as Accessor<string | null>,
    order: (() => getOrder()) as Accessor<string[]>,
    active: (() => {
      const id = getActiveId()
      if (!id) return undefined
      return getItems().find((t) => t.id === id)
    }) as Accessor<TabItem | undefined>,

    hasType(type: TabType) {
      return getItems().some((t) => t.type === type)
    },

    findByType(type: TabType) {
      return getItems().filter((t) => t.type === type)
    },

    findSession(dir: string, sessionId: string) {
      return getItems().find((t) => t.type === "session" && t.directory === dir && t.sessionId === sessionId)
    },

    findTerminal(dir: string, terminalId: string) {
      return getItems().find((t) => t.type === "terminal" && t.directory === dir && t.terminalId === terminalId)
    },

    patch(id: string, patch: Partial<TabItem>) {
      setItems((items) =>
        (items ?? []).map((t) => {
          if (t.id !== id) return t
          return { ...t, ...patch }
        }),
      )
    },

    add(tab: Omit<TabItem, "id">) {
      const id = `${tab.type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const newTab: TabItem = { ...tab, id }

      batch(() => {
        setItems((items) => [...(items || []), newTab])
        setOrder((order) => [...(order || []), id])
        setActiveId(id)
      })

      return id
    },

    addSession(dir: string, sessionId: string, title: string, badge?: TabItem["badge"]) {
      if (!dir) return ""

      const existing = getItems().find(
        (t) => t.type === "session" && t.directory === dir && t.sessionId === sessionId,
      )
      if (existing) {
        // Only update title/badge, don't change active tab
        setItems((items) => {
          const list = items ?? []
          return list.map((t) => {
            if (t.id !== existing.id) return t

            const sameTitle = t.title === title
            const nextA = badge?.additions
            const nextD = badge?.deletions
            const prevA = t.badge?.additions
            const prevD = t.badge?.deletions
            const sameBadge = nextA === prevA && nextD === prevD

            if (sameTitle && sameBadge) return t
            return { ...t, title, badge }
          })
        })
        return existing.id
      }

      return tabActions.add({
        type: "session",
        directory: dir,
        sessionId,
        title,
        badge,
        closable: true,
      })
    },

    addTerminal(dir: string, terminalId: string, title: string) {
      if (!dir) return ""

      const existing = getItems().find(
        (t) => t.type === "terminal" && t.directory === dir && t.terminalId === terminalId,
      )
      if (existing) {
        setActiveId(existing.id)
        return existing.id
      }

      return tabActions.add({
        type: "terminal",
        directory: dir,
        terminalId,
        title,
        closable: true,
      })
    },

    addReview(dir: string, sessionId: string, title: string, badge?: TabItem["badge"]) {
      if (!dir) return ""

      const existing = getItems().find(
        (t) => t.type === "review" && t.directory === dir && t.sessionId === sessionId,
      )
      if (existing) {
        setActiveId(existing.id)
        return existing.id
      }

      return tabActions.add({
        type: "review",
        directory: dir,
        sessionId,
        title: `Review: ${title}`,
        badge,
        closable: true,
      })
    },

    addFile(dir: string, filePath: string, title: string) {
      if (!dir) return ""

      const existing = getItems().find((t) => t.type === "file" && t.directory === dir && t.filePath === filePath)
      if (existing) {
        setActiveId(existing.id)
        return existing.id
      }

      return tabActions.add({
        type: "file",
        directory: dir,
        filePath,
        title,
        closable: true,
      })
    },

    close(tabId: string) {
      const items = getItems()
      if (!items || !Array.isArray(items)) return

      const index = items.findIndex((t) => t.id === tabId)
      if (index === -1) return

      const tab = items[index]
      if (!tab?.closable) return

      const filteredItems = items.filter((t) => t.id !== tabId)
      const currentOrder = getOrder()
      const base = currentOrder?.length ? currentOrder : items.map((item) => item.id)
      const order = (() => {
        const list = base.filter((id) => id !== tabId)
        const seen = new Set(list)
        const missing = filteredItems.filter((item) => !seen.has(item.id)).map((item) => item.id)
        if (missing.length === 0) return list
        return [...list, ...missing]
      })()

      const closedTabs = getClosedTabs()
      const closed = (() => {
        const list = [{ ...tab }, ...(closedTabs ?? [])]
        if (list.length <= MAX_CLOSED_TABS) return list
        return list.slice(0, MAX_CLOSED_TABS)
      })()

      const activeId = getActiveId()
      const active = (() => {
        if (activeId !== tabId) return activeId ?? null
        if (filteredItems.length === 0) return null
        const pos = base.indexOf(tabId)
        if (pos === -1) return filteredItems[0]?.id ?? null
        const next = Math.min(pos, filteredItems.length - 1)
        return filteredItems[next]?.id ?? null
      })()

      batch(() => {
        onClose?.(tab)
        setItems(() => filteredItems)
        setOrder(() => order)
        setClosedTabs(() => closed)
        setActiveId(active)
      })
    },

    closeActive() {
      const id = getActiveId()
      if (!id) return
      tabActions.close(id)
    },

    reopenLast() {
      const closedTabs = getClosedTabs()
      const lastClosed = closedTabs[0]
      if (!lastClosed) return

      produceAll((draft) => {
        draft.closedTabs.shift()
        draft.items.push(lastClosed)
        draft.order.push(lastClosed.id)
        draft.activeId = lastClosed.id
      })
    },

    setActive(tabId: string) {
      produceAll((draft) => {
        if (!draft || !draft.items) return
        const exists = draft.items.find((t) => t.id === tabId)
        if (exists) {
          draft.activeId = tabId
        }
      })
    },

    move(tabId: string, toIndex: number) {
      const currentOrder = getOrder()
      const fromIndex = currentOrder.indexOf(tabId)
      if (fromIndex === undefined || fromIndex === -1 || fromIndex === toIndex) return

      setOrder((order) => {
        const list = [...order]
        const [moved] = list.splice(fromIndex, 1)
        list.splice(toIndex, 0, moved)
        return list
      })
    },

    updateBadge(tabId: string, badge: TabItem["badge"]) {
      setItems((items) =>
        items.map((t, i) => {
          if (t.id !== tabId) return t
          return { ...t, badge }
        }),
      )
    },

    updateTitle(tabId: string, title: string) {
      setItems((items) =>
        items.map((t) => {
          if (t.id !== tabId) return t
          return { ...t, title }
        }),
      )
    },

    // Get tabs in display order - use direct store access for reactivity
    orderedItems: (() => {
      const items = getItems()
      const currentOrder = getOrder()
      const base = currentOrder.length ? currentOrder : items.map((item) => item.id)
      const seen = new Set(base)
      const missing = items.filter((item) => !seen.has(item.id)).map((item) => item.id)
      const order = missing.length ? [...base, ...missing] : base

      return order.map((id) => items.find((t) => t.id === id)).filter((t): t is TabItem => !!t)
    }) as Accessor<TabItem[]>,

    // Navigate to tab by index (for Cmd+1-9)
    activateByIndex(index: number) {
      const ordered = tabActions.orderedItems()
      const tab = ordered[index]
      if (tab) setActiveId(tab.id)
    },

    // Navigate to next/previous tab
    activateNext() {
      const ordered = tabActions.orderedItems()
      const currentIndex = ordered.findIndex((t) => t.id === getActiveId())
      if (currentIndex === -1) return
      const nextIndex = (currentIndex + 1) % ordered.length
      if (ordered[nextIndex]) setActiveId(ordered[nextIndex].id)
    },

    activatePrevious() {
      const ordered = tabActions.orderedItems()
      const currentIndex = ordered.findIndex((t) => t.id === getActiveId())
      if (currentIndex === -1) return
      const prevIndex = (currentIndex - 1 + ordered.length) % ordered.length
      if (ordered[prevIndex]) setActiveId(ordered[prevIndex].id)
    },
  }

  return tabActions
}

export const { use: useClaxedoLayout, provider: ClaxedoLayoutProvider } = createSimpleContext({
  name: "ClaxedoLayout",
  init: () => {
    const target = {
      ...Persist.global("claxedo.layout", ["claxedo.layout.v1"]),
      migrate: (value: unknown) => {
        if (!value || typeof value !== "object") return value

        // Migrate from flat tabs/worktree to groups/split
        if ("tabs" in value && !("groups" in value)) {
          const v = value as Record<string, unknown>
          const id = "g-initial"
          return {
            ...v,
            groups: [{ id, tabs: v.tabs, worktree: v.worktree ?? { default: null, pinned: null }, layout: defaultGroupLayout() }],
            split: { direction: "h", sizes: [1.0], focusedId: id },
          }
        }

        // Validate: if groups exists but is empty, create a default group
        if ("groups" in value) {
          const v = value as Record<string, unknown>
          const groups = v.groups
          if (Array.isArray(groups) && groups.length === 0) {
            const id = "g-default"
            return {
              ...v,
              groups: [{ id, tabs: createEmptyTabsState(), worktree: { default: null, pinned: null }, layout: defaultGroupLayout() }],
              split: { direction: "h", sizes: [1.0], focusedId: id },
            }
          }

          // Migrate: add layout to existing groups that lack it
          if (Array.isArray(groups) && groups.some((g: any) => !g.layout)) {
            return {
              ...v,
              groups: groups.map((g: any) => g.layout ? g : { ...g, layout: defaultGroupLayout() }),
            }
          }

          // Migrate: add reviewPanel to existing group layouts that lack it
          if (Array.isArray(groups) && groups.some((g: any) => g.layout && !g.layout.reviewPanel)) {
            return {
              ...v,
              groups: groups.map((g: any) =>
                g.layout && !g.layout.reviewPanel
                  ? { ...g, layout: { ...g.layout, reviewPanel: defaultGroupLayout().reviewPanel } }
                  : g,
              ),
            }
          }

          return value
        }

        if (!("workspaceTabs" in value)) return value

        const wsTabs = (value as { workspaceTabs?: unknown }).workspaceTabs
        if (!wsTabs || typeof wsTabs !== "object") return value

        const wsActive = (value as { activeWorkspaceId?: unknown }).activeWorkspaceId
        const active = typeof wsActive === "string" ? wsActive : null

        const entries = Object.entries(wsTabs as Record<string, unknown>)
          .map(([dir, raw]) => {
            if (!raw || typeof raw !== "object") return
            const items = (raw as { items?: unknown }).items
            if (!Array.isArray(items)) return
            const order = (raw as { order?: unknown }).order
            const ids = Array.isArray(order) ? order.filter((x): x is string => typeof x === "string") : []
            const list = items
              .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
              .map((t) => ({ ...t, directory: typeof t.directory === "string" ? t.directory : dir })) as unknown[]
            return { dir, ids, list }
          })
          .filter((x): x is { dir: string; ids: string[]; list: unknown[] } => !!x)

        const list = entries.flatMap((x) => x.list)
        const order = (() => {
          const first = active ? entries.find((e) => e.dir === active) : undefined
          const rest = entries.filter((e) => e.dir !== active)
          const base = [first, ...rest].filter((e): e is { dir: string; ids: string[]; list: unknown[] } => !!e)
          return base.flatMap((e) => e.ids)
        })()

        const activeId = (() => {
          if (typeof active !== "string") return null
          const raw = (wsTabs as Record<string, unknown>)[active]
          if (!raw || typeof raw !== "object") return null
          const id = (raw as { activeId?: unknown }).activeId
          if (typeof id === "string") return id
          return null
        })()

        const id = "g-initial"
        return {
          ...(value as Record<string, unknown>),
          groups: [{
            id,
            tabs: {
              items: list,
              activeId,
              order,
              closedTabs: [],
            },
            worktree: {
              default: active,
              pinned: null,
            },
          }],
          split: { direction: "h", sizes: [1.0], focusedId: id },
        }
      },
    }

    const [store, setStore, _, ready] = persisted(
      target,
      createStore<ClaxedoLayoutStore>({
        rail: {
          collapsed: true,
          hovered: false,
          pinned: false,
          locked: false,
        },
        groups: [{ id: "g-default", tabs: createEmptyTabsState(), worktree: { default: null, pinned: null }, layout: defaultGroupLayout() }],
        split: { direction: "h", sizes: [1.0], focusedId: "g-default" },
        enabled: true,
        terminalPane: {},
        terminalFocus: {},
        terminalZoom: {},
        terminalOwner: {},
        terminalAgentStatus: {},
        terminalAgentSeen: {},
        workspaceRecency: {},
      }),
    )

    // Timer IDs are plain variables, not in the persisted store
    let expandTimer: number | undefined
    let collapseTimer: number | undefined
    let cooldownUntil: number | undefined

    // Clean up timers on unmount
    onCleanup(() => {
      if (expandTimer) clearTimeout(expandTimer)
      if (collapseTimer) clearTimeout(collapseTimer)
    })

    // Helper to get the focused group
    const focusedGroup = () => {
      const id = store.split.focusedId
      return store.groups.find((g) => g.id === id) ?? store.groups[0]
    }

    // Rail management
    const rail = {
      collapsed: createMemo(() => store.rail.collapsed),
      hovered: createMemo(() => store.rail.hovered),
      pinned: createMemo(() => store.rail.pinned),
      locked: createMemo(() => store.rail.locked),
      width: createMemo(() =>
        store.rail.collapsed && !store.rail.pinned ? RAIL_COLLAPSED_WIDTH : RAIL_EXPANDED_WIDTH,
      ),

      // Lock the rail open (e.g., when dropdown is open)
      lock() {
        setStore("rail", "locked", true)
      },

      // Unlock the rail (e.g., when dropdown closes)
      unlock() {
        setStore("rail", "locked", false)
      },

      expand() {
        if (collapseTimer) {
          clearTimeout(collapseTimer)
          collapseTimer = undefined
        }
        setStore("rail", "collapsed", false)
      },

      collapse() {
        if (store.rail.pinned) return
        if (expandTimer) {
          clearTimeout(expandTimer)
          expandTimer = undefined
        }
        setStore("rail", "collapsed", true)
        setStore("rail", "hovered", false)
      },

      toggle() {
        // Clear any pending timers
        if (expandTimer) {
          clearTimeout(expandTimer)
          expandTimer = undefined
        }
        if (collapseTimer) {
          clearTimeout(collapseTimer)
          collapseTimer = undefined
        }

        batch(() => {
          if (store.rail.pinned) {
            setStore("rail", "pinned", false)
            setStore("rail", "collapsed", true)
            setStore("rail", "hovered", false)
          } else {
            setStore("rail", "pinned", true)
            setStore("rail", "collapsed", false)
            setStore("rail", "hovered", false)
          }
        })
      },

      pin() {
        setStore("rail", "pinned", true)
        setStore("rail", "collapsed", false)
      },

      unpin() {
        setStore("rail", "pinned", false)
      },

      // Handle mouse entering hot zone (leftmost 12px)
      handleHotZoneEnter() {
        if (store.rail.pinned || !store.rail.collapsed) return

        // Check cooldown to prevent immediate re-expansion after collapse
        if (cooldownUntil && Date.now() < cooldownUntil) return

        setStore("rail", "hovered", true)

        // Clear any pending collapse
        if (collapseTimer) {
          clearTimeout(collapseTimer)
          collapseTimer = undefined
        }

        // Schedule expand with delay
        const timer = window.setTimeout(() => {
          setStore("rail", "collapsed", false)
          expandTimer = undefined
        }, EXPAND_DELAY_MS)

        expandTimer = timer
      },

      // Handle mouse leaving rail area
      handleMouseLeave(e?: MouseEvent) {
        if (store.rail.pinned) return
        // Don't collapse if locked (e.g., dropdown menu is open)
        if (store.rail.locked) return

        // Clear any pending expand
        if (expandTimer) {
          clearTimeout(expandTimer)
          expandTimer = undefined
        }

        // Check if mouse is leaving to the left edge (would re-trigger hot zone)
        const isLeavingToLeft = e && e.clientX <= HOT_ZONE_WIDTH

        // Schedule collapse with delay
        const timer = window.setTimeout(() => {
          // Re-check locked state before collapsing
          if (store.rail.locked) return
          batch(() => {
            setStore("rail", "collapsed", true)
            setStore("rail", "hovered", false)
            collapseTimer = undefined
            // Set cooldown to prevent immediate re-expansion from hot zone
            // Longer cooldown if mouse is at left edge
            if (isLeavingToLeft) {
              cooldownUntil = Date.now() + 500
            }
          })
        }, COLLAPSE_DELAY_MS)

        collapseTimer = timer
      },

      // Cancel pending collapse (mouse re-entered)
      cancelCollapse() {
        if (collapseTimer) {
          clearTimeout(collapseTimer)
          collapseTimer = undefined
        }
      },
    }

    const clearTerminalTabState = (tab: string) => {
      const pane = store.terminalPane[tab]
      const flatten = (node: Pane | undefined): string[] => {
        if (!node) return []
        if (node.t === "leaf") return [node.id]
        return [...flatten(node.a), ...flatten(node.b)]
      }
      const paneIds = flatten(pane)
      const tabTerminal = store.groups
        .flatMap((g) => g.tabs.items)
        .find((t) => t.id === tab && t.type === "terminal")
      const tabIds = tabTerminal?.terminalId ? [tabTerminal.terminalId] : []
      const owned = Object.entries(store.terminalOwner)
        .filter(([, v]) => v === tab)
        .map(([k]) => k)
      const ids = [...new Set([...paneIds, ...tabIds, ...owned])]

      setStore("terminalPane", tab, undefined)
      setStore("terminalFocus", tab, undefined)
      setStore("terminalZoom", tab, undefined)

      for (const id of ids) {
        setStore("terminalOwner", id, undefined)
        setStore("terminalAgentStatus", id, undefined)
        setStore("terminalAgentSeen", id, undefined)
      }
    }

    // Group-specific tab actions factory (cached)
    const groupTabsCache = new Map<string, ReturnType<typeof createTabActions>>()

    const groupTabs = (groupId: string) => {
      const cached = groupTabsCache.get(groupId)
      if (cached) return cached

      const idx = () => store.groups.findIndex((g) => g.id === groupId)
      const actions = createTabActions(
        () => store.groups[idx()]?.tabs.items ?? [],
        () => store.groups[idx()]?.tabs.activeId ?? null,
        () => store.groups[idx()]?.tabs.order ?? [],
        () => store.groups[idx()]?.tabs.closedTabs ?? [],
        (fn) => setStore("groups", idx(), "tabs", "items", fn),
        (id) => setStore("groups", idx(), "tabs", "activeId", id),
        (fn) => setStore("groups", idx(), "tabs", "order", fn),
        (fn) => setStore("groups", idx(), "tabs", "closedTabs", fn),
        (fn) => setStore("groups", idx(), "tabs", produce(fn)),
        (tab) => {
          if (tab.type !== "terminal") return
          clearTerminalTabState(tab.id)
        },
      )
      groupTabsCache.set(groupId, actions)
      return actions
    }

    // Evict stale cache entries when groups change
    createEffect(on(
      () => store.groups.map(g => g.id),
      (ids) => {
        for (const key of groupTabsCache.keys()) {
          if (!ids.includes(key)) groupTabsCache.delete(key)
        }
      },
    ))

    // Group-specific worktree accessor
    const groupWorktree = (groupId: string) => {
      const idx = () => store.groups.findIndex((g) => g.id === groupId)
      return {
        default: (() => store.groups[idx()]?.worktree.default ?? null) as Accessor<string | null>,
        pinned: (() => store.groups[idx()]?.worktree.pinned ?? null) as Accessor<string | null>,
        setDefault(dir: string | null) {
          const i = idx()
          if (i === -1) return
          setStore("groups", i, "worktree", "default", dir)
        },
        setPinned(dir: string | null) {
          const i = idx()
          if (i === -1) return
          setStore("groups", i, "worktree", "pinned", dir)
        },
      }
    }

    // Group-specific layout accessor (file tree + session panel state per group)
    const groupLayout = (groupId: string) => {
      const idx = () => store.groups.findIndex((g) => g.id === groupId)
      const dl = defaultGroupLayout()
      return {
        fileTree: {
          opened: (() => store.groups[idx()]?.layout?.fileTree?.opened ?? dl.fileTree.opened) as Accessor<boolean>,
          width: (() => store.groups[idx()]?.layout?.fileTree?.width ?? dl.fileTree.width) as Accessor<number>,
          tab: (() => store.groups[idx()]?.layout?.fileTree?.tab ?? dl.fileTree.tab) as Accessor<string>,
          setOpened(v: boolean) { const i = idx(); if (i !== -1) setStore("groups", i, "layout", "fileTree", "opened", v) },
          setWidth(v: number) { const i = idx(); if (i !== -1) setStore("groups", i, "layout", "fileTree", "width", v) },
          setTab(v: "changes" | "all") { const i = idx(); if (i !== -1) setStore("groups", i, "layout", "fileTree", "tab", v) },
        },
        session: {
          width: (() => store.groups[idx()]?.layout?.session?.width ?? dl.session.width) as Accessor<number>,
          collapsed: (() => store.groups[idx()]?.layout?.session?.collapsed ?? dl.session.collapsed) as Accessor<boolean>,
          panelMode: (() => store.groups[idx()]?.layout?.session?.panelMode ?? dl.session.panelMode) as Accessor<number>,
          setWidth(v: number) { const i = idx(); if (i !== -1) setStore("groups", i, "layout", "session", "width", v) },
          setCollapsed(v: boolean) { const i = idx(); if (i !== -1) setStore("groups", i, "layout", "session", "collapsed", v) },
          setPanelMode(v: number) { const i = idx(); if (i !== -1) setStore("groups", i, "layout", "session", "panelMode", v) },
        },
        reviewPanel: {
          opened: (() => store.groups[idx()]?.layout?.reviewPanel?.opened ?? dl.reviewPanel.opened) as Accessor<boolean>,
          setOpened(v: boolean) {
            const i = idx()
            if (i === -1) return
            // Must set entire object when reviewPanel doesn't exist yet in the store,
            // because setStore can't traverse into undefined intermediate objects.
            if (!store.groups[i]?.layout?.reviewPanel) {
              setStore("groups", i, "layout", "reviewPanel", { opened: v })
            } else {
              setStore("groups", i, "layout", "reviewPanel", "opened", v)
            }
          },
        },
      }
    }

    // Backward-compatible worktree that delegates to the focused group
    const worktree = {
      default: (() => focusedGroup()?.worktree.default ?? null) as Accessor<string | null>,
      pinned: (() => focusedGroup()?.worktree.pinned ?? null) as Accessor<string | null>,

      setDefault(dir: string | null) {
        const g = focusedGroup()
        if (!g) return
        const i = store.groups.findIndex((gr) => gr.id === g.id)
        if (i === -1) return
        if (dir === store.groups[i].worktree.default) return
        setStore("groups", i, "worktree", "default", dir)
      },

      setPinned(dir: string | null) {
        const g = focusedGroup()
        if (!g) return
        const i = store.groups.findIndex((gr) => gr.id === g.id)
        if (i === -1) return
        if (dir === store.groups[i].worktree.pinned) return
        setStore("groups", i, "worktree", "pinned", dir)
      },
    }

    // Backward-compatible topTabs that delegates to the focused group
    const topTabs = createTabActions(
      () => { const g = focusedGroup(); return g?.tabs.items ?? [] },
      () => { const g = focusedGroup(); return g?.tabs.activeId ?? null },
      () => { const g = focusedGroup(); return g?.tabs.order ?? [] },
      () => { const g = focusedGroup(); return g?.tabs.closedTabs ?? [] },
      (fn) => {
        const g = focusedGroup()
        if (!g) return
        const i = store.groups.findIndex((gr) => gr.id === g.id)
        if (i === -1) return
        setStore("groups", i, "tabs", "items", fn)
      },
      (id) => {
        const g = focusedGroup()
        if (!g) return
        const i = store.groups.findIndex((gr) => gr.id === g.id)
        if (i === -1) return
        setStore("groups", i, "tabs", "activeId", id)
      },
      (fn) => {
        const g = focusedGroup()
        if (!g) return
        const i = store.groups.findIndex((gr) => gr.id === g.id)
        if (i === -1) return
        setStore("groups", i, "tabs", "order", fn)
      },
      (fn) => {
        const g = focusedGroup()
        if (!g) return
        const i = store.groups.findIndex((gr) => gr.id === g.id)
        if (i === -1) return
        setStore("groups", i, "tabs", "closedTabs", fn)
      },
      (fn) => {
        const g = focusedGroup()
        if (!g) return
        const i = store.groups.findIndex((gr) => gr.id === g.id)
        if (i === -1) return
        setStore("groups", i, "tabs", produce(fn))
      },
      (tab) => {
        if (tab.type !== "terminal") return
        clearTerminalTabState(tab.id)
      },
    )

    // Helper: merge tabs from removed groups into the first remaining group (with dedup)
    const mergeGroupTabs = (first: GroupState, removed: GroupState[]) => {
      const allItems = [
        ...first.tabs.items,
        ...removed.flatMap((g) => g.tabs.items.filter((tab) => tab.type !== "terminal")),
      ]
      const seen = new Set<string>()
      const mergedItems = allItems.filter((tab) => {
        let key: string
        if (tab.type === "session" && tab.sessionId) key = `session:${tab.sessionId}:${tab.directory}`
        else if (tab.type === "terminal" && tab.terminalId) key = `terminal:${tab.terminalId}:${tab.directory}`
        else return true
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      const mergedItemIds = new Set(mergedItems.map((t) => t.id))
      const allOrder = [...first.tabs.order, ...removed.flatMap((g) => g.tabs.order)]
      const mergedOrder = allOrder.filter((id) => mergedItemIds.has(id))
      const firstActive = first.tabs.activeId
      if (firstActive && mergedItemIds.has(firstActive)) {
        return { items: mergedItems, order: mergedOrder, activeId: firstActive }
      }
      const removedActive = removed.map((g) => g.tabs.activeId).find((id): id is string => !!id && mergedItemIds.has(id))
      if (removedActive) {
        return { items: mergedItems, order: mergedOrder, activeId: removedActive }
      }
      return { items: mergedItems, order: mergedOrder, activeId: mergedItems[0]?.id ?? null }
    }

    // Helper: clear stale terminal creating state for removed groups
    const clearStaleCreatingState = (removedGroupIds: Set<string>) => {
      if (removedGroupIds.has(creatingTerminalGroupId() ?? "")) {
        setCreatingTerminal(0)
        setCreatingTerminalGroupId(undefined)
        setPendingTerminalCreate(0)
        setPendingTerminalCommand(undefined)
        setPendingTerminalTitle(undefined)
        setPendingTerminalDir(undefined)
        setPendingTerminalGroupId(undefined)
      }
    }

    // Split actions
    const splitActions = {
      active: (() => store.groups.length > 1 && !store.split.hidden) as Accessor<boolean>,
      direction: (() => store.split.direction) as Accessor<"h" | "v">,
      sizes: (() => store.split.sizes) as Accessor<number[]>,
      focusedId: (() => store.split.focusedId) as Accessor<string | undefined>,
      groups: (() => store.groups) as Accessor<GroupState[]>,
      hidden: (() => !!store.split.hidden) as Accessor<boolean>,

      setFocus(groupId: string) {
        if (store.split.focusedId === groupId) return
        setStore("split", "focusedId", groupId)
      },

      setSizes(sizes: number[]) {
        setStore("split", "sizes", sizes)
      },

      toggle() {
        if (store.groups.length > 1) {
          // Toggle visibility — don't destroy groups
          const nextHidden = !store.split.hidden
          setStore("split", "hidden", nextHidden)
        } else {
          // Create new empty group
          const newId = `g-${Date.now()}`
          const newGroup: GroupState = {
            id: newId,
            tabs: createEmptyTabsState(),
            worktree: { default: store.groups[0]?.worktree.default ?? null, pinned: null },
            layout: defaultGroupLayout(),
          }
          batch(() => {
            setStore("groups", [...store.groups, newGroup])
            setStore("split", { direction: "h", sizes: [0.5, 0.5], focusedId: store.groups[0].id, hidden: false })
          })
        }
      },

      closeGroup(groupId: string) {
        if (store.groups.length <= 1) return
        const idx = store.groups.findIndex((g) => g.id === groupId)
        if (idx === -1) return
        const target = store.groups[idx]
        const remaining = store.groups.filter((g) => g.id !== groupId)
        const first = remaining[0]
        const merged = mergeGroupTabs(first, [target])
        const mergedIds = new Set(merged.items.map((t) => t.id))
        const droppedTerminals = target.tabs.items
          .filter((t) => t.type === "terminal" && !mergedIds.has(t.id))
          .map((t) => t.id)
        const removedGroupIds = new Set([groupId])
        batch(() => {
          for (const tab of droppedTerminals) {
            clearTerminalTabState(tab)
          }
          setStore("groups", remaining.map((g, i) =>
            i === 0 ? { ...g, tabs: { ...g.tabs, items: merged.items, order: merged.order, activeId: merged.activeId } } : g,
          ))
          setStore("split", "sizes", remaining.map(() => 1 / remaining.length))
          if (store.split.focusedId === groupId) {
            setStore("split", "focusedId", first.id)
          }
          if (remaining.length <= 1) {
            setStore("split", "hidden", false)
          }
          clearStaleCreatingState(removedGroupIds)
        })
      },

      moveTab(tabId: string, fromGroupId: string, toGroupId: string | "new") {
        const fromIdx = store.groups.findIndex((g) => g.id === fromGroupId)
        if (fromIdx === -1) return
        const tab = store.groups[fromIdx].tabs.items.find((t) => t.id === tabId)
        if (!tab) return

        batch(() => {
          // Remove from source group
          const fromItems = store.groups[fromIdx].tabs.items.filter((t) => t.id !== tabId)
          const fromOrder = store.groups[fromIdx].tabs.order.filter((id) => id !== tabId)
          const fromActive = store.groups[fromIdx].tabs.activeId === tabId
            ? (fromItems[0]?.id ?? null)
            : store.groups[fromIdx].tabs.activeId
          setStore("groups", fromIdx, "tabs", "items", fromItems)
          setStore("groups", fromIdx, "tabs", "order", fromOrder)
          setStore("groups", fromIdx, "tabs", "activeId", fromActive)

          if (toGroupId === "new") {
            // Create new group with this tab
            const newId = `g-${Date.now()}`
            const newGroup: GroupState = {
              id: newId,
              tabs: { items: [tab], activeId: tab.id, order: [tab.id], closedTabs: [] },
              worktree: { default: tab.directory, pinned: null },
              layout: defaultGroupLayout(),
            }
            setStore("groups", [...store.groups, newGroup])
            setStore("split", { direction: "h", sizes: store.groups.map(() => 1 / store.groups.length), focusedId: newId })
          } else {
            const toIdx = store.groups.findIndex((g) => g.id === toGroupId)
            if (toIdx === -1) return
            setStore("groups", toIdx, "tabs", "items", (items) => [...items, tab])
            setStore("groups", toIdx, "tabs", "order", (order) => [...order, tab.id])
            setStore("groups", toIdx, "tabs", "activeId", tab.id)
          }

          // Auto-remove empty groups (except keep at least 1)
          const nonEmpty = store.groups.filter((g) => g.tabs.items.length > 0)
          if (nonEmpty.length < store.groups.length && nonEmpty.length >= 1) {
            setStore("groups", nonEmpty)
            setStore("split", "sizes", nonEmpty.map(() => 1 / nonEmpty.length))
            if (!nonEmpty.find((g) => g.id === store.split.focusedId)) {
              setStore("split", "focusedId", nonEmpty[0].id)
            }
          }
        })
      },
    }

    // Find which group a tab belongs to
    const findTabGroup = (tabId: string): string | undefined => {
      return store.groups.find((g) => g.tabs.items.some((t) => t.id === tabId))?.id
    }

    // Patch a tab by ID, searching across all groups
    const patchTab = (tabId: string, patch: Partial<TabItem>) => {
      for (let i = 0; i < store.groups.length; i++) {
        if (store.groups[i].tabs.items.some((t) => t.id === tabId)) {
          setStore("groups", i, "tabs", "items",
            (items: TabItem[]) => (items ?? []).map((t) => (t.id !== tabId ? t : { ...t, ...patch })),
          )
          return
        }
      }
    }

    // Feature flag
    const enabled = createMemo(() => store.enabled)
    const setEnabled = (value: boolean) => setStore("enabled", value)

    // Terminal creation signal (used to trigger terminal creation from directory level)
    // This is needed because ClaxedoLayout is at app level (no terminal context),
    // but TerminalContentWrapper is at directory level (has terminal context)
    const [pendingTerminalCreate, setPendingTerminalCreate] = createSignal(0)
    const [pendingTerminalCommand, setPendingTerminalCommand] = createSignal<string | undefined>(undefined)
    const [pendingTerminalTitle, setPendingTerminalTitle] = createSignal<string | undefined>(undefined)
    const [pendingTerminalDir, setPendingTerminalDir] = createSignal<string | undefined>(undefined)
    const [pendingTerminalGroupId, setPendingTerminalGroupId] = createSignal<string | undefined>(undefined)
    const [creatingTerminal, setCreatingTerminal] = createSignal(0)
    const [creatingTerminalGroupId, setCreatingTerminalGroupId] = createSignal<string | undefined>(undefined)

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

    const leaf = (id: string): Pane => ({ t: "leaf", id })

    const list = (node: Pane | undefined): string[] => {
      if (!node) return []
      if (node.t === "leaf") return [node.id]
      return [...list(node.a), ...list(node.b)]
    }

    const includes = (node: Pane | undefined, id: string): boolean => {
      if (!node) return false
      if (node.t === "leaf") return node.id === id
      if (includes(node.a, id)) return true
      return includes(node.b, id)
    }

    const replace = (node: Pane, id: string, next: Pane): Pane => {
      if (node.t === "leaf") {
        if (node.id !== id) return node
        return next
      }
      const a = replace(node.a, id, next)
      const b = replace(node.b, id, next)
      return { ...node, a, b }
    }

    const remove = (node: Pane, id: string): Pane | undefined => {
      if (node.t === "leaf") {
        if (node.id !== id) return node
        return undefined
      }

      const a = remove(node.a, id)
      const b = remove(node.b, id)

      if (!a && !b) return undefined
      if (!a) return b
      if (!b) return a
      return { ...node, a, b }
    }

    const resize = (node: Pane, path: string, value: number): Pane => {
      if (node.t === "leaf") return node
      if (!path) return { ...node, size: clamp(value, 0.1, 0.9) }
      const head = path[0]
      const rest = path.slice(1)
      if (head === "a") return { ...node, a: resize(node.a, rest, value) }
      return { ...node, b: resize(node.b, rest, value) }
    }

    const find = (node: Pane | undefined, id: string): string | undefined => {
      if (!node) return
      if (node.t === "leaf") return node.id === id ? "" : undefined
      const a = find(node.a, id)
      if (a !== undefined) return "a" + a
      const b = find(node.b, id)
      if (b !== undefined) return "b" + b
      return
    }

    const requestTerminalCreate = (dir: string, command?: string, title?: string, groupId?: string) => {
      const debug = typeof localStorage !== "undefined" && localStorage.getItem("opencode.debug.terminal") === "1"
      if (debug) {
        // eslint-disable-next-line no-console
        console.log("[terminal]", "claxedo requestCreate", { dir, command, title, groupId })
      }
      setPendingTerminalCommand(command)
      setPendingTerminalTitle(title)
      setPendingTerminalDir(dir)
      setPendingTerminalGroupId(groupId)
      setPendingTerminalCreate((n) => n + 1)
      setCreatingTerminal((n) => n + 1)
      setCreatingTerminalGroupId(groupId)

      // Safety: auto-clear after timeout to prevent permanent button lockout
      // if created() is never called (e.g., PTY creation fails silently).
      // PTY creation normally completes in <2s; 5s gives ample headroom.
      setTimeout(() => {
        setCreatingTerminal((n) => Math.max(0, n - 1))
      }, 5000)
    }

    const clearPendingTerminalCreate = () => {
      setPendingTerminalCreate(0)
      setPendingTerminalCommand(undefined)
      setPendingTerminalTitle(undefined)
      setPendingTerminalDir(undefined)
      setPendingTerminalGroupId(undefined)
    }

    const consumePendingTerminalCommand = () => {
      const cmd = pendingTerminalCommand()
      const title = pendingTerminalTitle()
      setPendingTerminalCommand(undefined)
      setPendingTerminalTitle(undefined)
      const dir = pendingTerminalDir()
      setPendingTerminalDir(undefined)
      const gid = pendingTerminalGroupId()
      setPendingTerminalGroupId(undefined)
      return { directory: dir, command: cmd, title, groupId: gid }
    }

    // Workspace recency management
    const workspaceRecency = {
      /**
       * Get recent workspaces for a project (most recent first)
       * @param projectId - The project's worktree path
       * @param limit - Maximum number of workspaces to return (default 5)
       */
      getRecent(projectId: string, limit = 5): string[] {
        const recency = store.workspaceRecency[projectId] ?? []
        return recency.slice(0, limit)
      },

      /**
       * Record workspace access - moves workspace to front of recency list
       * @param projectId - The project's worktree path
       * @param workspaceDir - The workspace directory being accessed
       */
      recordAccess(projectId: string, workspaceDir: string) {
        const current = store.workspaceRecency[projectId] ?? []
        // Remove if already in list, then prepend
        const filtered = current.filter((dir) => dir !== workspaceDir)
        const updated = [workspaceDir, ...filtered]
        setStore("workspaceRecency", projectId, updated)
      },

      /**
       * Clean up recency list - remove deleted workspaces
       * @param projectId - The project's worktree path
       * @param validWorkspaces - List of currently valid workspace directories
       */
      cleanup(projectId: string, validWorkspaces: string[]) {
        const current = store.workspaceRecency[projectId] ?? []
        const validSet = new Set(validWorkspaces)
        const cleaned = current.filter((dir) => validSet.has(dir))
        if (cleaned.length !== current.length) {
          setStore("workspaceRecency", projectId, cleaned)
        }
      },
    }

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
      split: splitActions,
      findTabGroup,
      patchTab,
      workspaceRecency,
      // Terminal creation coordination
      terminal: {
        pendingCreate: pendingTerminalCreate,
        pendingCommand: pendingTerminalCommand,
        pendingDir: pendingTerminalDir,
        pendingGroupId: pendingTerminalGroupId,
        requestCreate: requestTerminalCreate,
        clearPendingCreate: clearPendingTerminalCreate,
        consumePendingCommand: consumePendingTerminalCommand,
        creating: creatingTerminal,
        creatingGroupId: creatingTerminalGroupId,

        created() {
          setCreatingTerminal((n) => Math.max(0, n - 1))
          if (creatingTerminal() === 0) setCreatingTerminalGroupId(undefined)
        },

        owner(id: string) {
          return store.terminalOwner[id]
        },

        own(tab: string, id: string) {
          setStore("terminalOwner", id, tab)
        },

        disown(id: string) {
          setStore("terminalOwner", id, undefined)
        },

        pane(tab: string) {
          return store.terminalPane[tab]
        },

        ids(tab: string) {
          return list(store.terminalPane[tab])
        },

        ensure(tab: string, id: string) {
          if (store.terminalPane[tab]) return
          setStore("terminalPane", tab, leaf(id))
          setStore("terminalFocus", tab, id)
        },

        focus(tab: string) {
          return store.terminalFocus[tab]
        },

        setFocus(tab: string, id: string) {
          setStore("terminalFocus", tab, id)
        },

        zoom(tab: string) {
          return store.terminalZoom[tab]
        },

        setZoom(tab: string, id: string | undefined) {
          setStore("terminalZoom", tab, id)
        },

        split(input: { tab: string; at: string; id: string; dir: PaneDir }) {
          const node = store.terminalPane[input.tab]
          if (!node) {
            setStore("terminalPane", input.tab, { t: "split", dir: input.dir, a: leaf(input.at), b: leaf(input.id), size: 0.5 })
            setStore("terminalFocus", input.tab, input.id)
            return
          }

          if (!includes(node, input.at)) {
            const ids = list(node)
            const first = ids[0]
            if (!first) return
            const next = replace(node, first, { t: "split", dir: input.dir, a: leaf(first), b: leaf(input.id), size: 0.5 })
            setStore("terminalPane", input.tab, next)
            setStore("terminalFocus", input.tab, input.id)
            return
          }

          const next = replace(node, input.at, { t: "split", dir: input.dir, a: leaf(input.at), b: leaf(input.id), size: 0.5 })
          setStore("terminalPane", input.tab, next)
          setStore("terminalFocus", input.tab, input.id)
        },

        close(input: { tab: string; id: string }) {
          const node = store.terminalPane[input.tab]
          if (!node) return
          const next = remove(node, input.id)
          setStore("terminalPane", input.tab, next)
          const ids = list(next)
          const focus = store.terminalFocus[input.tab]
          if (focus === input.id) {
            setStore("terminalFocus", input.tab, ids[0])
          }
          const zoom = store.terminalZoom[input.tab]
          if (zoom === input.id) {
            setStore("terminalZoom", input.tab, undefined)
          }
        },

        path(input: { tab: string; id: string }) {
          return find(store.terminalPane[input.tab], input.id)
        },

        resize(input: { tab: string; path: string; size: number }) {
          const node = store.terminalPane[input.tab]
          if (!node) return
          if (node.t === "leaf") return
          setStore("terminalPane", input.tab, resize(node, input.path, input.size))
        },

        swap(input: { tab: string; a: string; b: string }) {
          const node = store.terminalPane[input.tab]
          if (!node) return
          if (input.a === input.b) return
          if (!includes(node, input.a)) return
          if (!includes(node, input.b)) return

          const next = ((root: Pane): Pane => {
            const walk = (n: Pane): Pane => {
              if (n.t === "leaf") {
                if (n.id === input.a) return leaf(input.b)
                if (n.id === input.b) return leaf(input.a)
                return n
              }

              const a = walk(n.a)
              const b = walk(n.b)
              if (a === n.a && b === n.b) return n
              return { ...n, a, b }
            }
            return walk(root)
          })(node)

          setStore("terminalPane", input.tab, next)

          const focus = store.terminalFocus[input.tab]
          if (focus === input.a) setStore("terminalFocus", input.tab, input.b)
          if (focus === input.b) setStore("terminalFocus", input.tab, input.a)

          const zoom = store.terminalZoom[input.tab]
          if (zoom === input.a) setStore("terminalZoom", input.tab, input.b)
          if (zoom === input.b) setStore("terminalZoom", input.tab, input.a)
        },

        clear(tab: string) {
          clearTerminalTabState(tab)
        },

        // Agent status per terminal (PTY ID)
        agentStatus(terminalId: string): TerminalAgentStatus {
          return store.terminalAgentStatus[terminalId] ?? "idle"
        },

        setAgentStatus(terminalId: string, status: TerminalAgentStatus) {
          setStore("terminalAgentStatus", terminalId, status === "idle" ? undefined : status)
          // Mark as seen when agent becomes active (Start or PermissionRequest event received)
          // This tracks that the agent actually ran, preventing spurious "done" on startup
          if (status !== "idle") {
            setStore("terminalAgentSeen", terminalId, true)
          }
        },

        clearAgentStatus(terminalId: string) {
          setStore("terminalAgentStatus", terminalId, undefined)
        },

        /**
         * Clear the seen flag for a terminal (called when user views the tab)
         * This resets the "done" indicator so it won't show again until next agent cycle
         */
        clearSeen(terminalId: string) {
          setStore("terminalAgentSeen", terminalId, undefined)
        },

        /**
         * Get aggregated agent status for a tab (considering all terminals in the tab)
         * Priority: permission > working > idle
         * Returns { loading: boolean, attention: boolean, done: boolean }
         */
        getTabAgentStatus(tabId: string): { loading: boolean; attention: boolean; done: boolean } {
          // Get all terminal IDs in this tab
          const terminalIds = list(store.terminalPane[tabId])

          // Search all groups for the tab
          let tab: TabItem | undefined
          for (const group of store.groups) {
            tab = group.tabs.items.find((t) => t.id === tabId)
            if (tab) break
          }
          if (tab?.terminalId && !terminalIds.includes(tab.terminalId)) {
            terminalIds.push(tab.terminalId)
          }

          let hasWorking = false
          let hasPermission = false
          let hasSeen = false

          for (const id of terminalIds) {
            const status = store.terminalAgentStatus[id]
            if (status === "working") hasWorking = true
            if (status === "permission") hasPermission = true
            if (store.terminalAgentSeen[id]) hasSeen = true
          }

          return {
            loading: hasWorking,
            attention: hasPermission,
            done: hasSeen && !hasWorking && !hasPermission,
          }
        },
      },
      // Constants for components to use
      constants: {
        RAIL_COLLAPSED_WIDTH,
        RAIL_EXPANDED_WIDTH,
        HOT_ZONE_WIDTH,
      },
    }
  },
})
