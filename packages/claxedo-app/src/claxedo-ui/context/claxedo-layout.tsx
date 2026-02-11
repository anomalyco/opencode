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
import { paneFindPath, paneIncludes, paneList, reduceTerminalTab, type TerminalTabAction } from "./terminal-reducer"

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

export type Pane = { t: "leaf"; id: string } | { t: "split"; dir: PaneDir; a: Pane; b: Pane; size: number }
export type TerminalActionOrigin = { tabId: string; groupId: string; hostId: string }

/**
 * Agent status for a terminal
 * - idle: No agent running
 * - working: Agent is processing (shows amber spinner)
 * - permission: Agent needs user input (shows red dot)
 */
export type TerminalAgentStatus = "idle" | "working" | "permission"
export type TerminalLifecycleState = "creating" | "attaching" | "attached" | "closing" | "closed"

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
  // PTY id -> lifecycle state for split/close race hardening
  terminalLifecycle: Record<string, TerminalLifecycleState | undefined>

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

      const existing = getItems().find((t) => t.type === "session" && t.directory === dir && t.sessionId === sessionId)
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

      const existing = getItems().find((t) => t.type === "review" && t.directory === dir && t.sessionId === sessionId)
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
            groups: [
              {
                id,
                tabs: v.tabs,
                worktree: v.worktree ?? { default: null, pinned: null },
                layout: defaultGroupLayout(),
              },
            ],
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
              groups: [
                {
                  id,
                  tabs: createEmptyTabsState(),
                  worktree: { default: null, pinned: null },
                  layout: defaultGroupLayout(),
                },
              ],
              split: { direction: "h", sizes: [1.0], focusedId: id },
            }
          }

          // Migrate: add layout to existing groups that lack it
          if (Array.isArray(groups) && groups.some((g: any) => !g.layout)) {
            return {
              ...v,
              groups: groups.map((g: any) => (g.layout ? g : { ...g, layout: defaultGroupLayout() })),
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
          groups: [
            {
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
            },
          ],
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
        groups: [
          {
            id: "g-default",
            tabs: createEmptyTabsState(),
            worktree: { default: null, pinned: null },
            layout: defaultGroupLayout(),
          },
        ],
        split: { direction: "h", sizes: [1.0], focusedId: "g-default" },
        enabled: true,
        terminalPane: {},
        terminalFocus: {},
        terminalZoom: {},
        terminalOwner: {},
        terminalAgentStatus: {},
        terminalAgentSeen: {},
        terminalLifecycle: {},
        workspaceRecency: {},
      }),
    )

    // Timer IDs are plain variables, not in the persisted store
    let expandTimer: number | undefined
    let collapseTimer: number | undefined
    let cooldownUntil: number | undefined
    // Tracks whether a collapse was suppressed by the lock (dropdown open).
    // When unlock() is called and this flag is true, collapse is re-triggered.
    let collapseNeeded = false

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
      collapsed: (() => store.rail.collapsed) as Accessor<boolean>,
      hovered: (() => store.rail.hovered) as Accessor<boolean>,
      pinned: (() => store.rail.pinned) as Accessor<boolean>,
      locked: (() => store.rail.locked) as Accessor<boolean>,
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
        if (collapseNeeded) {
          collapseNeeded = false
          rail.handleMouseLeave()
        }
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
        if (store.rail.locked) {
          collapseNeeded = true
          return
        }

        collapseNeeded = false

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
          if (store.rail.locked) {
            collapseNeeded = true
            return
          }
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
        collapseNeeded = false
        if (collapseTimer) {
          clearTimeout(collapseTimer)
          collapseTimer = undefined
        }
      },

      /**
       * Unified position tracking for the document-level mousemove handler.
       * Handles both hot zone detection (collapsed) and mouse-outside-rail
       * collapse (expanded floating). This replaces reliance on the nav's
       * onMouseLeave, which doesn't fire reliably when pointer-events
       * transitions from none to auto while the mouse is over the element.
       */
      trackPosition(clientX: number, clientY: number, railRect: { top: number; right: number; bottom: number }) {
        if (store.rail.pinned) return

        if (store.rail.collapsed) {
          // Hot zone detection for expansion
          if (clientX <= HOT_ZONE_WIDTH) {
            rail.handleHotZoneEnter()
          }
        } else {
          // Expanded floating: detect mouse outside rail for collapse
          // Check both horizontal AND vertical bounds
          const isOutside = clientX > railRect.right || clientY < railRect.top || clientY > railRect.bottom
          if (isOutside) {
            // Only schedule collapse if one isn't already pending
            if (!collapseTimer) {
              rail.handleMouseLeave()
            }
          } else {
            rail.cancelCollapse()
          }
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
      const tabTerminal = store.groups.flatMap((g) => g.tabs.items).find((t) => t.id === tab && t.type === "terminal")
      const tabIds = tabTerminal?.terminalId ? [tabTerminal.terminalId] : []
      const owned = Object.entries(store.terminalOwner)
        .filter(([, v]) => v === tab)
        .map(([k]) => k)
      const ids = [...new Set([...paneIds, ...tabIds, ...owned])]

      setStore("terminalFocus", tab, undefined)
      setStore("terminalZoom", tab, undefined)

      for (const id of ids) {
        setStore("terminalOwner", id, undefined)
        setStore("terminalAgentStatus", id, undefined)
        setStore("terminalAgentSeen", id, undefined)
        setStore("terminalLifecycle", id, "closing")
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
    createEffect(
      on(
        () => store.groups.map((g) => g.id),
        (ids) => {
          for (const key of groupTabsCache.keys()) {
            if (!ids.includes(key)) groupTabsCache.delete(key)
          }
        },
      ),
    )

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
          setOpened(v: boolean) {
            const i = idx()
            if (i !== -1) setStore("groups", i, "layout", "fileTree", "opened", v)
          },
          setWidth(v: number) {
            const i = idx()
            if (i !== -1) setStore("groups", i, "layout", "fileTree", "width", v)
          },
          setTab(v: "changes" | "all") {
            const i = idx()
            if (i !== -1) setStore("groups", i, "layout", "fileTree", "tab", v)
          },
        },
        session: {
          width: (() => store.groups[idx()]?.layout?.session?.width ?? dl.session.width) as Accessor<number>,
          collapsed: (() =>
            store.groups[idx()]?.layout?.session?.collapsed ?? dl.session.collapsed) as Accessor<boolean>,
          panelMode: (() =>
            store.groups[idx()]?.layout?.session?.panelMode ?? dl.session.panelMode) as Accessor<number>,
          setWidth(v: number) {
            const i = idx()
            if (i !== -1) setStore("groups", i, "layout", "session", "width", v)
          },
          setCollapsed(v: boolean) {
            const i = idx()
            if (i !== -1) setStore("groups", i, "layout", "session", "collapsed", v)
          },
          setPanelMode(v: number) {
            const i = idx()
            if (i !== -1) setStore("groups", i, "layout", "session", "panelMode", v)
          },
        },
        reviewPanel: {
          opened: (() =>
            store.groups[idx()]?.layout?.reviewPanel?.opened ?? dl.reviewPanel.opened) as Accessor<boolean>,
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
      () => {
        const g = focusedGroup()
        return g?.tabs.items ?? []
      },
      () => {
        const g = focusedGroup()
        return g?.tabs.activeId ?? null
      },
      () => {
        const g = focusedGroup()
        return g?.tabs.order ?? []
      },
      () => {
        const g = focusedGroup()
        return g?.tabs.closedTabs ?? []
      },
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
      const removedActive = removed
        .map((g) => g.tabs.activeId)
        .find((id): id is string => !!id && mergedItemIds.has(id))
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

    const defaultForNewGroup = () => {
      const primary = store.groups[0]
      if (!primary) return null
      if (primary.worktree.default) return primary.worktree.default
      if (!primary.tabs.activeId) return null
      const active = primary.tabs.items.find((t) => t.id === primary.tabs.activeId)
      return active?.directory ?? null
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
            worktree: { default: defaultForNewGroup(), pinned: null },
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
        const firstIdx = store.groups.findIndex((g) => g.id === first.id)
        const merged = mergeGroupTabs(first, [target])
        const mergedIds = new Set(merged.items.map((t) => t.id))
        const droppedTerminals = target.tabs.items
          .filter((t) => t.type === "terminal" && !mergedIds.has(t.id))
          .map((t) => t.id)
        const removedGroupIds = new Set([groupId])
        batch(() => {
          for (const tab of droppedTerminals) {
            clearTerminalTabState(tab)
            setStore("terminalPane", tab, undefined)
          }
          // Update the surviving group's tabs via path-based setStore to
          // preserve SolidJS store proxy identity.  Using { ...g } spread
          // creates a new raw object which breaks <For> reference tracking,
          // causing DOM destruction/recreation and orphaning terminal portals.
          setStore("groups", firstIdx, "tabs", "items", merged.items)
          setStore("groups", firstIdx, "tabs", "order", merged.order)
          setStore("groups", firstIdx, "tabs", "activeId", merged.activeId)
          // Remove the target group.  Remaining groups keep their raw objects
          // (only nested tabs were modified above), so proxy identity holds.
          setStore(
            "groups",
            store.groups.filter((g) => g.id !== groupId),
          )
          setStore(
            "split",
            "sizes",
            remaining.map(() => 1 / remaining.length),
          )
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
          const fromActive =
            store.groups[fromIdx].tabs.activeId === tabId
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
            setStore("split", {
              direction: "h",
              sizes: store.groups.map(() => 1 / store.groups.length),
              focusedId: newId,
            })
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
            setStore(
              "split",
              "sizes",
              nonEmpty.map(() => 1 / nonEmpty.length),
            )
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
          setStore("groups", i, "tabs", "items", (items: TabItem[]) =>
            (items ?? []).map((t) => (t.id !== tabId ? t : { ...t, ...patch })),
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
    const [splitPendingTab, setSplitPendingTab] = createSignal<string | undefined>(undefined)
    const [closingTerminalIds, setClosingTerminalIds] = createSignal<string[]>([])

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

    const terminalActionError = (
      action: string,
      payload: {
        origin?: TerminalActionOrigin
        targetTab?: string
        expectedGroupId?: string
        terminalId?: string
        ownerTab?: string
        paneIds?: string[]
        reason?: string
      },
    ) => {
      if (!import.meta.env.DEV) return
      // eslint-disable-next-line no-console
      console.error("[terminal:invariant]", {
        action,
        ...payload,
      })
    }

    const terminalLifecycleTransition = {
      creating: new Set<TerminalLifecycleState>(["attaching", "attached", "closing", "closed"]),
      attaching: new Set<TerminalLifecycleState>(["attached", "closing", "closed"]),
      attached: new Set<TerminalLifecycleState>(["closing", "closed"]),
      closing: new Set<TerminalLifecycleState>(["closed"]),
      closed: new Set<TerminalLifecycleState>(["creating"]),
    } satisfies Record<TerminalLifecycleState, Set<TerminalLifecycleState>>

    const transitionTerminalLifecycle = (id: string, next: TerminalLifecycleState, reason?: string) => {
      const current = store.terminalLifecycle[id]
      if (current === next) return true
      const allowed =
        current === undefined ? new Set<TerminalLifecycleState>(["creating", "attaching", "attached", "closing", "closed"]) : terminalLifecycleTransition[current]
      if (allowed.has(next)) {
        setStore("terminalLifecycle", id, next)
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[terminal:lifecycle]", { id, from: current, to: next, reason })
        }
        return true
      }
      terminalActionError("transitionLifecycle", {
        terminalId: id,
        reason: `illegal_transition:${current ?? "undefined"}->${next}${reason ? `:${reason}` : ""}`,
      })
      return false
    }

    const assertTerminalInvariant = (
      action: string,
      ok: boolean,
      payload: {
        origin?: TerminalActionOrigin
        targetTab?: string
        expectedGroupId?: string
        terminalId?: string
        ownerTab?: string
        paneIds?: string[]
        reason?: string
      },
    ) => {
      if (ok) return true
      terminalActionError(action, payload)
      return false
    }

    const requireTerminalOrigin = (action: string, tabId: string, origin?: TerminalActionOrigin) => {
      if (store.groups.length <= 1) return true
      if (!assertTerminalInvariant(action, !!origin, { origin, targetTab: tabId, reason: "missing_origin" })) return false
      if (!origin) return false
      if (!assertTerminalInvariant(action, origin.tabId === tabId, { origin, targetTab: tabId, reason: "origin_tab_mismatch" }))
        return false
      const groupId = findTabGroup(tabId)
      if (!groupId) return true
      if (origin.groupId === groupId) return true
      return assertTerminalInvariant(action, false, {
        origin,
        targetTab: tabId,
        expectedGroupId: groupId,
        reason: "origin_group_mismatch",
      })
    }

    const requireTerminalInTabPane = (action: string, tabId: string, terminalId: string, origin?: TerminalActionOrigin) => {
      const pane = store.terminalPane[tabId]
      const paneIds = paneList(pane)
      return assertTerminalInvariant(action, paneIds.includes(terminalId), {
        origin,
        targetTab: tabId,
        terminalId,
        paneIds,
        reason: "terminal_not_in_target_tab_pane",
      })
    }

    const requireTerminalOwnerMatchesTab = (
      action: string,
      tabId: string,
      terminalId: string,
      origin?: TerminalActionOrigin,
    ) => {
      const ownerTab = store.terminalOwner[terminalId]
      if (!ownerTab) return true
      return assertTerminalInvariant(action, ownerTab === tabId, {
        origin,
        targetTab: tabId,
        terminalId,
        ownerTab,
        reason: "owner_tab_mismatch",
      })
    }

    const reduceTerminalInTab = (tab: string, action: TerminalTabAction) => {
      const current = {
        pane: store.terminalPane[tab],
        focus: store.terminalFocus[tab],
        zoom: store.terminalZoom[tab],
      }
      const next = reduceTerminalTab(current, action)
      if (next.pane !== current.pane) setStore("terminalPane", tab, next.pane)
      if (next.focus !== current.focus) setStore("terminalFocus", tab, next.focus)
      if (next.zoom !== current.zoom) setStore("terminalZoom", tab, next.zoom)
      return next
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
        splitPendingTab,

        beginSplit(tab: string) {
          setSplitPendingTab(tab)
        },

        clearSplitPending(tab?: string) {
          if (!tab || splitPendingTab() === tab) setSplitPendingTab(undefined)
        },

        isClosing(id: string) {
          return closingTerminalIds().includes(id)
        },

        beginClosing(id: string) {
          transitionTerminalLifecycle(id, "closing", "beginClosing")
          setClosingTerminalIds((all) => (all.includes(id) ? all : [...all, id]))
        },

        clearClosing(id: string) {
          transitionTerminalLifecycle(id, "closed", "clearClosing")
          setClosingTerminalIds((all) => all.filter((item) => item !== id))
        },

        lifecycle(id: string) {
          return store.terminalLifecycle[id]
        },

        transitionLifecycle(id: string, state: TerminalLifecycleState, reason?: string) {
          return transitionTerminalLifecycle(id, state, reason)
        },

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

        detachFromTab(input: { tab: string; id: string; origin?: TerminalActionOrigin }) {
          if (!requireTerminalOrigin("detachFromTab", input.tab, input.origin)) return
          if (!requireTerminalOwnerMatchesTab("detachFromTab", input.tab, input.id, input.origin)) return
          if (!requireTerminalInTabPane("detachFromTab", input.tab, input.id, input.origin)) return
          reduceTerminalInTab(input.tab, { type: "detach", id: input.id })
          setStore("terminalOwner", input.id, undefined)
        },

        pane(tab: string) {
          return store.terminalPane[tab]
        },

        ids(tab: string) {
          return paneList(store.terminalPane[tab])
        },

        ensure(tab: string, id: string) {
          reduceTerminalInTab(tab, { type: "ensure", id })
        },

        focus(tab: string) {
          return store.terminalFocus[tab]
        },

        setFocus(tab: string, id: string) {
          reduceTerminalInTab(tab, { type: "set_focus", id })
        },

        focusInTab(input: { tab: string; id: string; origin?: TerminalActionOrigin }) {
          if (!requireTerminalOrigin("focusInTab", input.tab, input.origin)) return
          if (!requireTerminalInTabPane("focusInTab", input.tab, input.id, input.origin)) return
          reduceTerminalInTab(input.tab, { type: "focus", id: input.id })
        },

        zoom(tab: string) {
          return store.terminalZoom[tab]
        },

        setZoom(tab: string, id: string | undefined) {
          reduceTerminalInTab(tab, { type: "set_zoom", id })
        },

        zoomInTab(input: { tab: string; id: string; origin?: TerminalActionOrigin }) {
          if (!requireTerminalOrigin("zoomInTab", input.tab, input.origin)) return
          if (!requireTerminalInTabPane("zoomInTab", input.tab, input.id, input.origin)) return
          reduceTerminalInTab(input.tab, { type: "zoom", id: input.id })
        },

        split(input: { tab: string; at: string; id: string; dir: PaneDir }) {
          reduceTerminalInTab(input.tab, { type: "split", at: input.at, id: input.id, dir: input.dir })
        },

        splitInTab(input: { tab: string; at: string; id: string; dir: PaneDir; origin?: TerminalActionOrigin }) {
          if (!requireTerminalOrigin("splitInTab", input.tab, input.origin)) return
          if (!requireTerminalOwnerMatchesTab("splitInTab", input.tab, input.id, input.origin)) return
          const node = store.terminalPane[input.tab]
          if (node && !assertTerminalInvariant("splitInTab", paneIncludes(node, input.at), {
            origin: input.origin,
            targetTab: input.tab,
            terminalId: input.at,
            paneIds: paneList(node),
            reason: "split_target_not_in_tab",
          })) {
            return
          }
          reduceTerminalInTab(input.tab, { type: "split", at: input.at, id: input.id, dir: input.dir })
        },

        close(input: { tab: string; id: string }) {
          reduceTerminalInTab(input.tab, { type: "close", id: input.id })
        },

        closeInTab(input: { tab: string; id: string; origin?: TerminalActionOrigin }) {
          if (!requireTerminalOrigin("closeInTab", input.tab, input.origin)) return
          if (!requireTerminalOwnerMatchesTab("closeInTab", input.tab, input.id, input.origin)) return
          if (!requireTerminalInTabPane("closeInTab", input.tab, input.id, input.origin)) return
          reduceTerminalInTab(input.tab, { type: "close", id: input.id })
        },

        path(input: { tab: string; id: string }) {
          return paneFindPath(store.terminalPane[input.tab], input.id)
        },

        resize(input: { tab: string; path: string; size: number }) {
          reduceTerminalInTab(input.tab, { type: "resize", path: input.path, size: input.size })
        },

        swap(input: { tab: string; a: string; b: string }) {
          reduceTerminalInTab(input.tab, { type: "swap", a: input.a, b: input.b })
        },

        clear(tab: string) {
          clearTerminalTabState(tab)
          setStore("terminalPane", tab, undefined)
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
          const terminalIds = paneList(store.terminalPane[tabId])

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
      // Tab grouping helpers for worktree-based UI
      getWorktreeColor(directory: string): string {
        const WORKTREE_COLORS = [
          "#3b82f6", // blue-500
          "#22c55e", // green-500
          "#a855f7", // purple-500
          "#f97316", // orange-500
          "#ec4899", // pink-500
          "#14b8a6", // teal-500
          "#f59e0b", // amber-500
          "#6366f1", // indigo-500
        ]

        // Use deterministic hash of directory path for consistent colors
        // This ensures colors don't change when other worktrees are added/removed
        let hash = 0
        for (let i = 0; i < directory.length; i++) {
          const char = directory.charCodeAt(i)
          hash = (hash << 5) - hash + char
          hash = hash & hash // Convert to 32bit integer
        }

        const index = Math.abs(hash) % WORKTREE_COLORS.length
        return WORKTREE_COLORS[index]
      },

      getWorktreeName(directory: string): string {
        const parts = directory.split("/")
        return parts[parts.length - 1] || parts[parts.length - 2] || "unknown"
      },

      getTabGroupInfo(
        groupId: string,
      ): Array<{ directory: string; color: string; tabs: Array<TabItem & { isLastInGroup: boolean }> }> {
        const group = store.groups.find((g) => g.id === groupId)
        if (!group) return []

        // Group tabs by directory
        const byDirectory = new Map<string, TabItem[]>()
        for (const tab of group.tabs.items) {
          const existing = byDirectory.get(tab.directory) || []
          existing.push(tab)
          byDirectory.set(tab.directory, existing)
        }

        // Build group info with isLastInGroup flag
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
        // Can only drag within same worktree
        return fromDir === toDir
      },

      getActiveWorktreeColor(groupId: string): string | undefined {
        const wt = groupWorktree(groupId)
        const activeDir = wt.pinned() || wt.default()
        if (!activeDir) return undefined
        return this.getWorktreeColor(activeDir)
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
