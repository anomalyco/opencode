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

// Flat panel structure - either a terminal or a split container
export type Panel = {
  id: string
  parentId?: string
  // For terminal panels
  ptyId?: string
  // For split panels
  direction?: SplitDirection
  children?: [string, string] // panel IDs
  sizes?: [number, number]
}

// A tab's split pane state
export type TabPane = {
  id: string
  root: string // root panel ID
  panels: Record<string, Panel>
  focused?: string // focused panel ID
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
    const existing = new Set(store.all.map((pty) => pty.titleNumber))
    let next = 1
    while (existing.has(next)) next++
    return next
  }

  const createPty = async (tabId?: string): Promise<LocalPTY | undefined> => {
    const num = getNextTitleNumber()
    const pty = await sdk.client.pty.create({ title: `Terminal ${num}` }).catch((e) => {
      console.error("Failed to create terminal", e)
      return undefined
    })
    if (!pty?.data?.id) return undefined
    return {
      id: pty.data.id,
      title: pty.data.title ?? "Terminal",
      titleNumber: num,
      tabId: tabId ?? pty.data.id,
    }
  }

  // Get all ptyIds from a panel and its children
  const getAllPtyIds = (pane: TabPane, panelId: string): string[] => {
    const panel = pane.panels[panelId]
    if (!panel) return []
    if (panel.ptyId) return [panel.ptyId]
    if (panel.children && panel.children.length === 2) {
      return [...getAllPtyIds(pane, panel.children[0]), ...getAllPtyIds(pane, panel.children[1])]
    }
    return []
  }

  // Migrate legacy terminals without tabId
  const migrate = (terminals: LocalPTY[]) =>
    terminals.map((p) => ((p as { tabId?: string }).tabId ? p : { ...p, tabId: p.id }))

  const tabs = createMemo(() => migrate(store.all).filter((p) => p.tabId === p.id))
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

    update(pty: Partial<LocalPTY> & { id: string }) {},

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
      const ptyIds = pane ? getAllPtyIds(pane, pane.root) : [tabId]

      // Remove all terminals in this tab
      setStore(
        "all",
        store.all.filter((x) => !ptyIds.includes(x.id)),
      )

      // Remove pane
      setStore(
        "panes",
        produce((panes) => {
          delete panes[tabId]
        }),
      )

      // Update active
      if (store.active === tabId) {
        const remaining = store.all.filter((p) => p.tabId === p.id && !ptyIds.includes(p.id))
        setStore("active", remaining[0]?.tabId)
      }

      // Clean up PTYs on server
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
        // First split - create initial structure
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
        // Split existing panel
        const focusedPanelId = pane.focused
        if (!focusedPanelId) return

        const focusedPanel = pane.panels[focusedPanelId]
        if (!focusedPanel?.ptyId) return // Can only split terminal panels

        const oldPtyId = focusedPanel.ptyId
        const newSplitId = generateId()
        const newTerminalId = generateId()

        // Add child panels first
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
        // Convert parent to split - update properties individually
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
      if (!ptyId) return // Can only close terminal panels

      // If closing the root terminal (no parent), close the whole tab
      if (!panel.parentId) {
        await this.closeTab(tabId)
        return
      }

      const parentPanel = pane.panels[panel.parentId]
      if (!parentPanel?.children || parentPanel.children.length !== 2) return

      // Find sibling
      const siblingId = parentPanel.children[0] === panelId ? parentPanel.children[1] : parentPanel.children[0]
      const sibling = pane.panels[siblingId]
      if (!sibling) return

      batch(() => {
        // Replace parent with sibling's content
        if (sibling.ptyId) {
          // Sibling is a terminal - parent becomes terminal
          setStore("panes", tabId, "panels", panel.parentId!, {
            id: panel.parentId!,
            parentId: parentPanel.parentId,
            ptyId: sibling.ptyId,
          })
        } else if (sibling.children && sibling.children.length === 2) {
          // Sibling is a split - parent inherits its split
          setStore("panes", tabId, "panels", panel.parentId!, {
            id: panel.parentId!,
            parentId: parentPanel.parentId,
            direction: sibling.direction,
            children: sibling.children,
            sizes: sibling.sizes,
          })
          // Update children's parentId
          setStore("panes", tabId, "panels", sibling.children[0], "parentId", panel.parentId!)
          setStore("panes", tabId, "panels", sibling.children[1], "parentId", panel.parentId!)
        }

        // Remove closed panel and sibling
        setStore(
          "panes",
          tabId,
          "panels",
          produce((panels) => {
            delete panels[panelId]
            delete panels[siblingId]
          }),
        )

        // Update focus
        const newFocused = sibling.ptyId ? panel.parentId! : (sibling.children?.[0] ?? panel.parentId!)
        setStore("panes", tabId, "focused", newFocused)

        // Remove terminal from all
        setStore(
          "all",
          store.all.filter((x) => x.id !== ptyId),
        )

        // If only one terminal left, remove pane entirely
        const remainingPanels = Object.values(store.panes[tabId]?.panels ?? {})
        if (remainingPanels.length === 1 && remainingPanels[0]?.ptyId === tabId) {
          setStore(
            "panes",
            produce((panes) => {
              delete panes[tabId]
            }),
          )
        }
      })

      // Clean up PTY on server
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
