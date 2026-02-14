import { createEffect, on, type Accessor } from "solid-js"
import { produce, type SetStoreFunction } from "solid-js/store"
import { createTabActions } from "./tab-actions"
import { defaultGroupLayout, type ClaxedoLayoutStore } from "./types"

export function createGroupAccessors(input: {
  store: ClaxedoLayoutStore
  setStore: SetStoreFunction<ClaxedoLayoutStore>
  focusedGroup: () => ClaxedoLayoutStore["groups"][number] | undefined
  clearTerminalTabState: (tab: string) => void
}) {
  const { store, setStore, focusedGroup, clearTerminalTabState } = input

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
      (tab, remainingItems, newActiveId) => {
        if (tab.type === "terminal") clearTerminalTabState(tab.id)

        // Update worktree.default when last tab for that directory is closed
        const i = idx()
        if (i === -1) return
        const currentDefault = store.groups[i].worktree.default
        if (!currentDefault || currentDefault !== tab.directory) return
        const hasOther = remainingItems.some((t) => t.directory === currentDefault)
        if (hasOther) return
        // Only switch if there's a next active tab; if no tabs remain, keep current default
        const newActive = remainingItems.find((t) => t.id === newActiveId)
        if (newActive) setStore("groups", i, "worktree", "default", newActive.directory)
      },
      (tab) => {
        if (!tab.directory) return
        const i = idx()
        if (i === -1) return
        if (store.groups[i].worktree.default) return
        setStore("groups", i, "worktree", "default", tab.directory)
      },
    )
    groupTabsCache.set(groupId, actions)
    return actions
  }

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
        collapsed: (() => store.groups[idx()]?.layout?.session?.collapsed ?? dl.session.collapsed) as Accessor<boolean>,
        panelMode: (() => store.groups[idx()]?.layout?.session?.panelMode ?? dl.session.panelMode) as Accessor<number>,
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
        opened: (() => store.groups[idx()]?.layout?.reviewPanel?.opened ?? dl.reviewPanel.opened) as Accessor<boolean>,
        setOpened(v: boolean) {
          const i = idx()
          if (i === -1) return
          if (!store.groups[i]?.layout?.reviewPanel) {
            setStore("groups", i, "layout", "reviewPanel", { opened: v })
            return
          }
          setStore("groups", i, "layout", "reviewPanel", "opened", v)
        },
      },
    }
  }

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

  const topTabs = createTabActions(
    () => {
      const g = focusedGroup()
      return g?.tabs.items ?? []
    },
    () => {
      const g = focusedGroup()
      const id = g?.tabs.activeId ?? null
      // In split mode, empty groups are intentional — return a sentinel to
      // prevent the "ensure active tab" effect from auto-creating a session.
      if (!id && store.groups.length > 1) return "__split_empty__"
      return id
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
    (tab, remainingItems, newActiveId) => {
      if (tab.type === "terminal") clearTerminalTabState(tab.id)

      // Update worktree.default when last tab for that directory is closed
      const g = focusedGroup()
      if (!g) return
      const i = store.groups.findIndex((gr) => gr.id === g.id)
      if (i === -1) return
      const currentDefault = store.groups[i].worktree.default
      if (!currentDefault || currentDefault !== tab.directory) return
      const hasOther = remainingItems.some((t) => t.directory === currentDefault)
      if (hasOther) return
      // Only switch if there's a next active tab; if no tabs remain, keep current default
      const newActive = remainingItems.find((t) => t.id === newActiveId)
      if (newActive) setStore("groups", i, "worktree", "default", newActive.directory)
    },
    (tab) => {
      if (!tab.directory) return
      const g = focusedGroup()
      if (!g) return
      const i = store.groups.findIndex((gr) => gr.id === g.id)
      if (i === -1) return
      if (store.groups[i].worktree.default) return
      setStore("groups", i, "worktree", "default", tab.directory)
    },
  )

  return {
    groupTabs,
    groupWorktree,
    groupLayout,
    topTabs,
    worktree,
  }
}
