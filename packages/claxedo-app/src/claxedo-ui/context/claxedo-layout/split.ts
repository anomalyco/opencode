import { batch, type Accessor } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import { createEmptyTabsState, defaultGroupLayout, type ClaxedoLayoutStore, type GroupState } from "./types"

export function mergeGroupTabs(first: GroupState, removed: GroupState[]) {
  const allItems = [...first.tabs.items, ...removed.flatMap((g) => g.tabs.items.filter((tab) => tab.type !== "terminal"))]
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

export function createSplitActions(input: {
  store: ClaxedoLayoutStore
  setStore: SetStoreFunction<ClaxedoLayoutStore>
  clearTerminalTabState: (tab: string) => void
  clearStaleCreatingState: (removedGroupIds: Set<string>) => void
  defaultForNewGroup: () => string | null
}) {
  const { store, setStore, clearTerminalTabState, clearStaleCreatingState, defaultForNewGroup } = input

  return {
    active: (() => store.groups.length > 1 && !store.split.hidden) as Accessor<boolean>,
    direction: (() => store.split.direction) as Accessor<"h" | "v">,
    sizes: (() => store.split.sizes) as Accessor<number[]>,
    focusedId: (() => store.split.focusedId) as Accessor<string | undefined>,
    groups: (() => {
      const fg = store.split.focusedId
      if (!fg || store.groups.length <= 1) return store.groups
      const focused = store.groups.find((g) => g.id === fg)
      if (!focused || store.groups[0] === focused) return store.groups
      return [focused, ...store.groups.filter((g) => g.id !== fg)]
    }) as Accessor<GroupState[]>,
    orderedGroups: (() => store.groups) as Accessor<GroupState[]>,
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
        const nextHidden = !store.split.hidden
        setStore("split", "hidden", nextHidden)
        return
      }

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
      const droppedTerminals = target.tabs.items.filter((t) => t.type === "terminal" && !mergedIds.has(t.id)).map((t) => t.id)
      const removedGroupIds = new Set([groupId])

      batch(() => {
        for (const tab of droppedTerminals) {
          clearTerminalTabState(tab)
          setStore("terminalPane", tab, undefined)
        }

        setStore("groups", firstIdx, "tabs", "items", merged.items)
        setStore("groups", firstIdx, "tabs", "order", merged.order)
        setStore("groups", firstIdx, "tabs", "activeId", merged.activeId)

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
        const fromItems = store.groups[fromIdx].tabs.items.filter((t) => t.id !== tabId)
        const fromOrder = store.groups[fromIdx].tabs.order.filter((id) => id !== tabId)
        const fromActive = store.groups[fromIdx].tabs.activeId === tabId ? (fromItems[0]?.id ?? null) : store.groups[fromIdx].tabs.activeId
        setStore("groups", fromIdx, "tabs", "items", fromItems)
        setStore("groups", fromIdx, "tabs", "order", fromOrder)
        setStore("groups", fromIdx, "tabs", "activeId", fromActive)

        if (toGroupId === "new") {
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
}
