import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo, createRoot, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "./sdk"
import { Persist, persisted } from "@/utils/persist"

export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  tabId: string
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
}

export type SplitDirection = "horizontal" | "vertical"

export type Panel = {
  id: string
  parentId?: string
  ptyId?: string
  direction?: SplitDirection
  children?: [string, string]
  sizes?: [number, number]
}

export type TabPane = {
  id: string
  root: string
  panels: Record<string, Panel>
  focused?: string
}

const WORKSPACE_KEY = "__workspace__"
const MAX_TERMINAL_SESSIONS = 20

type TerminalSession = ReturnType<typeof createTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
}

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

function createTerminalSession(sdk: ReturnType<typeof useSDK>, dir: string, id: string | undefined) {
  const legacy = `${dir}/terminal${id ? "/" + id : ""}.v1`

  const [store, setStore, _, ready] = persisted(
    Persist.scoped(dir, id, "terminal", [legacy]),
    createStore<{
      active?: string
      all: LocalPTY[]
      panes: Record<string, TabPane>
    }>({
      all: [],
      panes: {},
    }),
  )

  const getNextTitleNumber = () => {
    const existing = new Set(store.all.filter((p) => p.tabId === p.id).map((pty) => pty.titleNumber))
    let next = 1
    while (existing.has(next)) next++
    return next
  }

  const createPty = async (tabId?: string): Promise<LocalPTY | undefined> => {
    const tab = tabId ? store.all.find((p) => p.id === tabId) : undefined
    const num = tab?.titleNumber ?? getNextTitleNumber()
    const title = tab?.title ?? `Terminal ${num}`
    const pty = await sdk.client.pty.create({ title }).catch((e) => {
      console.error("Failed to create terminal", e)
      return undefined
    })
    if (!pty?.data?.id) return undefined
    return {
      id: pty.data.id,
      title,
      titleNumber: num,
      tabId: tabId ?? pty.data.id,
    }
  }

  const getAllPtyIds = (pane: TabPane, panelId: string): string[] => {
    const panel = pane.panels[panelId]
    if (!panel) return []
    if (panel.ptyId) return [panel.ptyId]
    if (panel.children && panel.children.length === 2) {
      return [...getAllPtyIds(pane, panel.children[0]), ...getAllPtyIds(pane, panel.children[1])]
    }
    return []
  }

  const getFirstLeaf = (pane: TabPane, panelId: string): string | undefined => {
    const panel = pane.panels[panelId]
    if (!panel) return undefined
    if (panel.ptyId) return panelId
    if (panel.children?.[0]) return getFirstLeaf(pane, panel.children[0])
    return undefined
  }

  const migrate = (terminals: LocalPTY[]) =>
    terminals.map((p) => ((p as { tabId?: string }).tabId ? p : { ...p, tabId: p.id }))

  const tabCache = new Map<string, LocalPTY>()
  const tabs = createMemo(() => {
    const migrated = migrate(store.all)
    const seen = new Set<string>()
    const result: LocalPTY[] = []
    for (const p of migrated) {
      if (!seen.has(p.tabId)) {
        seen.add(p.tabId)
        const cached = tabCache.get(p.tabId)
        if (cached) {
          cached.title = p.title
          cached.titleNumber = p.titleNumber
          result.push(cached)
        } else {
          const tab = { ...p, id: p.tabId }
          tabCache.set(p.tabId, tab)
          result.push(tab)
        }
      }
    }
    for (const key of tabCache.keys()) {
      if (!seen.has(key)) tabCache.delete(key)
    }
    return result
  })
  const all = createMemo(() => migrate(store.all))

  return {
    ready,
    tabs,
    all,
    active: () => store.active,
    panes: () => store.panes,
    pane: (tabId: string) => store.panes[tabId],
    panel: (tabId: string, panelId: string) => store.panes[tabId]?.panels[panelId],
    focused: (tabId: string) => store.panes[tabId]?.focused,

    async new() {
      const pty = await createPty()
      if (!pty) return
      setStore("all", [...store.all, pty])
      setStore("active", pty.tabId)
    },

    update(pty: Partial<LocalPTY> & { id: string }) {
      setStore("all", (x) => x.map((x) => (x.id === pty.id ? { ...x, ...pty } : x)))
      sdk.client.pty
        .update({
          ptyID: pty.id,
          title: pty.title,
          size: pty.cols && pty.rows ? { rows: pty.rows, cols: pty.cols } : undefined,
        })
        .catch((e) => {
          console.error("Failed to update terminal", e)
        })
    },

    async clone(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      const pty = store.all[index]
      if (!pty) return
      const clone = await sdk.client.pty.create({ title: pty.title }).catch((e) => {
        console.error("Failed to clone terminal", e)
        return undefined
      })
      if (!clone?.data) return
      setStore("all", index, { ...pty, ...clone.data })
      if (store.active === pty.tabId) {
        setStore("active", pty.tabId)
      }
    },

    open(id: string) {
      setStore("active", id)
    },

    async close(id: string) {
      const pty = store.all.find((x) => x.id === id)
      if (!pty) return

      const pane = store.panes[pty.tabId]
      if (pane) {
        const panelId = Object.keys(pane.panels).find((key) => pane.panels[key].ptyId === id)
        if (panelId) {
          await this.closeSplit(pty.tabId, panelId)
          return
        }
      }

      if (store.active === pty.tabId) {
        const remaining = store.all.filter((p) => p.tabId === p.id && p.id !== id)
        setStore("active", remaining[0]?.tabId)
      }

      setStore(
        "all",
        store.all.filter((x) => x.id !== id),
      )

      await sdk.client.pty.remove({ ptyID: id }).catch((e) => {
        console.error("Failed to close terminal", e)
      })
    },

    async closeTab(tabId: string) {
      const pane = store.panes[tabId]
      const terminalsInTab = store.all.filter((p) => p.tabId === tabId)
      const ptyIds = pane ? getAllPtyIds(pane, pane.root) : terminalsInTab.map((p) => p.id)

      const remainingTabs = store.all.filter((p) => p.tabId !== tabId)
      const uniqueTabIds = [...new Set(remainingTabs.map((p) => p.tabId))]

      setStore(
        "all",
        store.all.filter((x) => !ptyIds.includes(x.id)),
      )
      setStore(
        "panes",
        produce((panes) => {
          delete panes[tabId]
        }),
      )
      if (store.active === tabId) {
        setStore("active", uniqueTabIds[0])
      }
      for (const ptyId of ptyIds) {
        await sdk.client.pty.remove({ ptyID: ptyId }).catch((e) => {
          console.error("Failed to close terminal", e)
        })
      }
    },

    move(id: string, to: number) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index === -1) return
      setStore(
        "all",
        produce((all) => {
          all.splice(to, 0, all.splice(index, 1)[0])
        }),
      )
    },

    async split(tabId: string, direction: SplitDirection) {
      const pane = store.panes[tabId]
      const newPty = await createPty(tabId)
      if (!newPty) return

      setStore("all", [...store.all, newPty])

      if (!pane) {
        const rootId = generateId()
        const leftId = generateId()
        const rightId = generateId()

        setStore("panes", tabId, {
          id: tabId,
          root: rootId,
          panels: {
            [rootId]: {
              id: rootId,
              direction,
              children: [leftId, rightId],
              sizes: [50, 50],
            },
            [leftId]: {
              id: leftId,
              parentId: rootId,
              ptyId: tabId,
            },
            [rightId]: {
              id: rightId,
              parentId: rootId,
              ptyId: newPty.id,
            },
          },
          focused: rightId,
        })
      } else {
        const focusedPanelId = pane.focused
        if (!focusedPanelId) return

        const focusedPanel = pane.panels[focusedPanelId]
        if (!focusedPanel?.ptyId) return

        const oldPtyId = focusedPanel.ptyId
        const newSplitId = generateId()
        const newTerminalId = generateId()

        setStore("panes", tabId, "panels", newSplitId, {
          id: newSplitId,
          parentId: focusedPanelId,
          ptyId: oldPtyId,
        })
        setStore("panes", tabId, "panels", newTerminalId, {
          id: newTerminalId,
          parentId: focusedPanelId,
          ptyId: newPty.id,
        })
        setStore("panes", tabId, "panels", focusedPanelId, "ptyId", undefined)
        setStore("panes", tabId, "panels", focusedPanelId, "direction", direction)
        setStore("panes", tabId, "panels", focusedPanelId, "children", [newSplitId, newTerminalId])
        setStore("panes", tabId, "panels", focusedPanelId, "sizes", [50, 50])
        setStore("panes", tabId, "focused", newTerminalId)
      }
    },

    focus(tabId: string, panelId: string) {
      if (store.panes[tabId]) {
        setStore("panes", tabId, "focused", panelId)
      }
    },

    async closeSplit(tabId: string, panelId: string) {
      const pane = store.panes[tabId]
      if (!pane) return

      const panel = pane.panels[panelId]
      if (!panel) return

      const ptyId = panel.ptyId
      if (!ptyId) return

      if (!panel.parentId) {
        await this.closeTab(tabId)
        return
      }

      const parentPanel = pane.panels[panel.parentId]
      if (!parentPanel?.children || parentPanel.children.length !== 2) return

      const siblingId = parentPanel.children[0] === panelId ? parentPanel.children[1] : parentPanel.children[0]
      const sibling = pane.panels[siblingId]
      if (!sibling) return

      const newFocused = sibling.ptyId ? panel.parentId! : (getFirstLeaf(pane, sibling.children![0]) ?? panel.parentId!)

      batch(() => {
        setStore(
          "panes",
          tabId,
          "panels",
          produce((panels) => {
            const parent = panels[panel.parentId!]
            if (!parent) return

            if (sibling.ptyId) {
              parent.ptyId = sibling.ptyId
              parent.direction = undefined
              parent.children = undefined
              parent.sizes = undefined
            } else if (sibling.children && sibling.children.length === 2) {
              parent.ptyId = undefined
              parent.direction = sibling.direction
              parent.children = sibling.children
              parent.sizes = sibling.sizes
              panels[sibling.children[0]].parentId = panel.parentId!
              panels[sibling.children[1]].parentId = panel.parentId!
            }

            delete panels[panelId]
            delete panels[siblingId]
          }),
        )

        setStore("panes", tabId, "focused", newFocused)

        setStore(
          "all",
          store.all.filter((x) => x.id !== ptyId),
        )
      })

      const remainingPanels = Object.values(store.panes[tabId]?.panels ?? {})
      const shouldCleanupPane = remainingPanels.length === 1 && remainingPanels[0]?.ptyId

      if (shouldCleanupPane) {
        setStore(
          "panes",
          produce((panes) => {
            delete panes[tabId]
          }),
        )
      }

      await sdk.client.pty.remove({ ptyID: ptyId }).catch((e) => {
        console.error("Failed to close terminal", e)
      })
    },

    resizeSplit(tabId: string, panelId: string, sizes: [number, number]) {
      if (store.panes[tabId]?.panels[panelId]) {
        setStore("panes", tabId, "panels", panelId, "sizes", sizes)
      }
    },
  }
}

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext({
  name: "Terminal",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const params = useParams()
    const cache = new Map<string, TerminalCacheEntry>()

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)

    const prune = () => {
      while (cache.size > MAX_TERMINAL_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const load = (dir: string, id: string | undefined) => {
      const key = `${dir}:${id ?? WORKSPACE_KEY}`
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createTerminalSession(sdk, dir, id),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    const session = createMemo(() => load(params.dir!, params.id))

    return {
      ready: () => session().ready(),
      tabs: () => session().tabs(),
      all: () => session().all(),
      active: () => session().active(),
      panes: () => session().panes(),
      pane: (tabId: string) => session().pane(tabId),
      panel: (tabId: string, panelId: string) => session().panel(tabId, panelId),
      focused: (tabId: string) => session().focused(tabId),
      new: () => session().new(),
      update: (pty: Partial<LocalPTY> & { id: string }) => session().update(pty),
      clone: (id: string) => session().clone(id),
      open: (id: string) => session().open(id),
      close: (id: string) => session().close(id),
      closeTab: (tabId: string) => session().closeTab(tabId),
      move: (id: string, to: number) => session().move(id, to),
      split: (tabId: string, direction: SplitDirection) => session().split(tabId, direction),
      focus: (tabId: string, panelId: string) => session().focus(tabId, panelId),
      closeSplit: (tabId: string, panelId: string) => session().closeSplit(tabId, panelId),
      resizeSplit: (tabId: string, panelId: string, sizes: [number, number]) =>
        session().resizeSplit(tabId, panelId, sizes),
    }
  },
})
