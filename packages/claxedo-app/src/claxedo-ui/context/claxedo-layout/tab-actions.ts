import { batch, type Accessor } from "solid-js"
import type { TabItem, TabType, TopTabsState } from "./types"

const MAX_CLOSED_TABS = 10

export function createTabActions(
  getItems: () => TabItem[],
  getActiveId: () => string | null,
  getOrder: () => string[],
  getClosedTabs: () => TabItem[],
  setItems: (fn: (items: TabItem[]) => TabItem[]) => void,
  setActiveId: (id: string | null) => void,
  setOrder: (fn: (order: string[]) => string[]) => void,
  setClosedTabs: (fn: (tabs: TabItem[]) => TabItem[]) => void,
  produceAll: (fn: (draft: TopTabsState) => void) => void,
  onClose?: (tab: TabItem, remainingItems: TabItem[], newActiveId: string | null) => void,
  onAdd?: (tab: TabItem) => void,
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
        onAdd?.(newTab)
      })

      return id
    },

    addSession(dir: string, sessionId: string, title: string, badge?: TabItem["badge"]) {
      if (!dir) return ""

      const existing = getItems().find((t) => t.type === "session" && t.directory === dir && t.sessionId === sessionId)
      if (existing) {
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

      const existing = getItems().find((t) => t.type === "terminal" && t.directory === dir && t.terminalId === terminalId)
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
        onClose?.(tab, filteredItems, active)
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

    orderedItems: (() => {
      const items = getItems()
      const currentOrder = getOrder()
      const base = currentOrder.length ? currentOrder : items.map((item) => item.id)
      const seen = new Set(base)
      const missing = items.filter((item) => !seen.has(item.id)).map((item) => item.id)
      const order = missing.length ? [...base, ...missing] : base

      return order.map((id) => items.find((t) => t.id === id)).filter((t): t is TabItem => !!t)
    }) as Accessor<TabItem[]>,

    /** Items grouped by directory then flattened — matches the visual tab bar order. */
    visualOrderedItems: (() => {
      const ordered = tabActions.orderedItems()
      const groups = new Map<string, TabItem[]>()
      for (const tab of ordered) {
        const existing = groups.get(tab.directory) || []
        existing.push(tab)
        groups.set(tab.directory, existing)
      }
      return Array.from(groups.values()).flat()
    }) as Accessor<TabItem[]>,

    activateByIndex(index: number) {
      const ordered = tabActions.visualOrderedItems()
      const tab = ordered[index]
      if (tab) setActiveId(tab.id)
    },

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
