import { createMemo, createSignal, batch } from "solid-js"
import { createStore } from "solid-js/store"
import { persisted } from "@/utils/persist"

export type WorkspaceTabType = "browser" | "file" | "review" | "terminal" | "chat"

export interface WorkspaceTab {
  id: string
  type: WorkspaceTabType
  title: string
  state: Record<string, unknown>
  isPinned?: boolean
  isActive: boolean
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeTabId: string | null
}

type ClosedWorkspaceTab = Omit<WorkspaceTab, "id" | "isActive">

type WorkspacePersistenceTarget = {
  storage?: string
  legacyStorageNames?: string[]
  key: string
  legacy?: string[]
}

let tabCounter = 0

function generateTabId(type: WorkspaceTabType): string {
  return `${type}-${++tabCounter}-${Date.now()}`
}

function createDefaultState(): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isWorkspaceTabType(value: unknown): value is WorkspaceTabType {
  return value === "browser" || value === "file" || value === "review" || value === "terminal" || value === "chat"
}

function duplicateState(tab: WorkspaceTab) {
  if (tab.type === "terminal") return {}
  if (tab.type === "chat") return Object.fromEntries(Object.entries(tab.state).filter(([key]) => key !== "sessionID"))
  return { ...tab.state }
}

export function migrateWorkspaceState(value: unknown): WorkspaceState {
  if (!isRecord(value)) return createDefaultState()

  const seen = new Set<string>()
  const tabs = (Array.isArray(value.tabs) ? value.tabs : [])
    .map((item): WorkspaceTab | undefined => {
      if (!isRecord(item) || !isWorkspaceTabType(item.type)) return undefined

      const id = typeof item.id === "string" && item.id ? item.id : generateTabId(item.type)
      if (seen.has(id)) return undefined
      seen.add(id)

      return {
        id,
        type: item.type,
        title: typeof item.title === "string" && item.title ? item.title : getDefaultTitle(item.type),
        state: isRecord(item.state) ? { ...item.state } : {},
        isPinned: item.isPinned === true,
        isActive: false,
      }
    })
    .filter((item): item is WorkspaceTab => !!item)

  const activeTabId =
    typeof value.activeTabId === "string" && tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : tabs[0]?.id ?? null

  return {
    tabs: tabs.map((tab) => ({ ...tab, isActive: tab.id === activeTabId })),
    activeTabId,
  }
}

export function createWorkspaceTabs(options?: { persist?: WorkspacePersistenceTarget }) {
  const [state, setState, ready] = options?.persist
    ? (() => {
        const [store, setStore, _, storeReady] = persisted(
          { ...options.persist, migrate: migrateWorkspaceState },
          createStore<WorkspaceState>(createDefaultState()),
        )
        return [store, setStore, storeReady] as const
      })()
    : (() => {
        const [store, setStore] = createStore<WorkspaceState>(createDefaultState())
        return [store, setStore, () => true] as const
      })()

  const activeTab = createMemo(() => state.tabs.find((t) => t.isActive))
  const pinnedTabs = createMemo(() => state.tabs.filter((t) => t.isPinned))
  const regularTabs = createMemo(() => state.tabs.filter((t) => !t.isPinned))
  const allTabs = createMemo(() => state.tabs)
  const closedTabs: ClosedWorkspaceTab[] = []
  const [closedCount, setClosedCount] = createSignal(0)

  const rememberClosed = (tab: WorkspaceTab) => {
    closedTabs.push({
      type: tab.type,
      title: tab.title,
      state: { ...tab.state },
      isPinned: tab.isPinned,
    })
    if (closedTabs.length > 20) closedTabs.shift()
    setClosedCount(closedTabs.length)
  }

  const openTab = (type: WorkspaceTabType, options?: {
    title?: string
    state?: Record<string, unknown>
    isPinned?: boolean
    activate?: boolean
  }) => {
    const id = generateTabId(type)
    const tab: WorkspaceTab = {
      id,
      type,
      title: options?.title || getDefaultTitle(type),
      state: options?.state || {},
      isPinned: options?.isPinned || false,
      isActive: options?.activate !== false,
    }

    batch(() => {
      // Deactivate other tabs if activating this one
      if (tab.isActive) {
        setState("tabs", (tabs) =>
          tabs.map((t) => ({ ...t, isActive: false }))
        )
      }
      setState("tabs", (tabs) => [...tabs, tab])
      if (tab.isActive) {
        setState("activeTabId", id)
      }
    })

    return id
  }

  const closeTab = (id: string, options?: { force?: boolean }) => {
    const tabIndex = state.tabs.findIndex((t) => t.id === id)
    if (tabIndex === -1) return

    const tab = state.tabs[tabIndex]
    const wasActive = tab.isActive
    const isPinned = tab.isPinned

    // Don't close pinned tabs unless forced
    if (isPinned && !options?.force && tab.state.forceClose !== true) return

    rememberClosed(tab)
    const remaining = state.tabs.filter((item) => item.id !== id)
    setState("tabs", remaining)

    if (!remaining.length) {
      setState("activeTabId", null)
      return
    }

    if (!wasActive) return

    const replacement = remaining[Math.min(tabIndex, remaining.length - 1)]
    if (!replacement) {
      setState("activeTabId", null)
      return
    }

    setState("tabs", (tabs) => tabs.map((item) => ({ ...item, isActive: item.id === replacement.id })))
    setState("activeTabId", replacement.id)
  }

  const activateTab = (id: string) => {
    const tab = state.tabs.find((t) => t.id === id)
    if (!tab) return
    if (state.activeTabId === id && tab.isActive) return

    batch(() => {
      setState("tabs", (tabs) =>
        tabs.map((t) => ({ ...t, isActive: t.id === id }))
      )
      setState("activeTabId", id)
    })
  }

  const updateTab = (id: string, updates: Partial<WorkspaceTab>) => {
    setState("tabs", (tabs) =>
      tabs.map((tab) => {
        if (tab.id !== id) return tab

        const next = { ...tab, ...updates }
        if (
          next.id === tab.id &&
          next.type === tab.type &&
          next.title === tab.title &&
          next.state === tab.state &&
          next.isPinned === tab.isPinned &&
          next.isActive === tab.isActive
        ) {
          return tab
        }

        return next
      })
    )
  }

  const updateTabState = (id: string, stateUpdates: Record<string, unknown>) => {
    setState("tabs", (tabs) =>
      tabs.map((tab) => {
        if (tab.id !== id) return tab
        if (Object.entries(stateUpdates).every(([key, value]) => tab.state[key] === value)) return tab
        return { ...tab, state: { ...tab.state, ...stateUpdates } }
      })
    )
  }

  const pinTab = (id: string) => {
    updateTab(id, { isPinned: true })
  }

  const unpinTab = (id: string) => {
    updateTab(id, { isPinned: false })
  }

  const duplicateTab = (id: string) => {
    const tab = getTab(id)
    if (!tab) return undefined
    return openTab(tab.type, {
      title: tab.title,
      state: duplicateState(tab),
      isPinned: false,
    })
  }

  const closeOtherTabs = (id: string) => {
    const target = getTab(id)
    if (!target) return

    const closing = state.tabs.filter((tab) => tab.id !== id && !tab.isPinned)
    closing.forEach(rememberClosed)
    const remaining = state.tabs.filter((tab) => tab.id === id || tab.isPinned)

    batch(() => {
      setState("tabs", remaining.map((tab) => ({ ...tab, isActive: tab.id === id })))
      setState("activeTabId", id)
    })
  }

  const closeAllTabs = () => {
    const closing = state.tabs.filter((tab) => !tab.isPinned)
    closing.forEach(rememberClosed)
    const remaining = state.tabs.filter((tab) => tab.isPinned)
    const activeId = remaining[0]?.id ?? null

    batch(() => {
      setState("tabs", remaining.map((tab) => ({ ...tab, isActive: tab.id === activeId })))
      setState("activeTabId", activeId)
    })
  }

  const reopenClosedTab = () => {
    const tab = closedTabs.pop()
    setClosedCount(closedTabs.length)
    if (!tab) return undefined
    return openTab(tab.type, {
      title: tab.title,
      state: { ...tab.state },
      isPinned: tab.isPinned,
    })
  }

  const activateIndex = (index: number) => {
    const tab = state.tabs[index]
    if (!tab) return
    activateTab(tab.id)
  }

  const activateAdjacent = (offset: -1 | 1) => {
    if (!state.tabs.length) return
    const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
    const current = index === -1 ? 0 : index
    const next = (current + offset + state.tabs.length) % state.tabs.length
    const tab = state.tabs[next]
    if (!tab) return
    activateTab(tab.id)
  }

  const reorderTabs = (fromIndex: number, toIndex: number) => {
    const tabs = [...state.tabs]
    const [moved] = tabs.splice(fromIndex, 1)
    if (!moved) return
    tabs.splice(toIndex, 0, moved)
    setState("tabs", tabs)
  }

  const getTab = (id: string) => state.tabs.find((t) => t.id === id)

  const getTabsByType = (type: WorkspaceTabType) =>
    state.tabs.filter((t) => t.type === type)

  return {
    state,
    activeTab,
    pinnedTabs,
    regularTabs,
    allTabs,
    ready,
    openTab,
    closeTab,
    activateTab,
    updateTab,
    updateTabState,
    pinTab,
    unpinTab,
    duplicateTab,
    closeOtherTabs,
    closeAllTabs,
    reopenClosedTab,
    canReopenClosedTab: () => closedCount() > 0,
    activateIndex,
    activateAdjacent,
    reorderTabs,
    getTab,
    getTabsByType,
  }
}

function getDefaultTitle(type: WorkspaceTabType): string {
  switch (type) {
    case "browser":
      return "Browser"
    case "file":
      return "File"
    case "review":
      return "Review"
    case "terminal":
      return "Terminal"
    case "chat":
      return "Chat"
    default:
      return "Tab"
  }
}
