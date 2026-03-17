import { createSignal, batch, type Accessor } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"

export type Route = { type: "home" } | { type: "session"; sessionID: string }

let nextID = 1
export function resetTabID() {
  nextID = 1
}
function tabID() {
  return "tab_" + nextID++
}

export type Tab = {
  id: string
  sessionID: string | null
  label: string
  route: Route
  directory?: string
}

export type TabContext = {
  tabs: Accessor<Tab[]>
  active: Accessor<Tab>
  activeIndex: Accessor<number>
  add(opts?: { sessionID?: string; directory?: string; label?: string }): string
  close(id: string): void
  activate(id: string): void
  last(): void
  rename(id: string, label: string): void
  updateRoute(id: string, route: Route): void
  updateSessionID(id: string, sessionID: string): void
  updateDirectory(id: string, directory: string): void
  _setNavigator(nav: (route: Route) => void): void
  previousID: Accessor<string | null>
  position: Accessor<"top" | "bottom">
  setPosition(p: "top" | "bottom"): void
  load(state: { tabs: Tab[]; activeID: string; previousID: string | null; position: "top" | "bottom" }): void
}

export function createTabState(opts?: { position?: "top" | "bottom" }) {
  const initial: Tab = {
    id: tabID(),
    sessionID: null,
    label: "Untitled",
    route: { type: "home" },
  }
  const [tabs, setTabs] = createStore<Tab[]>([initial])
  const [activeID, setActiveID] = createSignal(initial.id)
  const [previousID, setPreviousID] = createSignal<string | null>(null)
  const [position, setPositionRaw] = createSignal<"top" | "bottom">(opts?.position ?? "bottom")

  let navigator: ((route: Route) => void) | undefined

  const result: TabContext = {
    tabs: () => tabs,
    active: () => tabs.find((t) => t.id === activeID()) ?? tabs[0],
    activeIndex: () => tabs.findIndex((t) => t.id === activeID()),
    add(opts) {
      const id = tabID()
      const tab: Tab = {
        id,
        sessionID: opts?.sessionID ?? null,
        label: opts?.label ?? "Untitled",
        route: opts?.sessionID ? { type: "session", sessionID: opts.sessionID } : { type: "home" },
        directory: opts?.directory,
      }
      batch(() => {
        setTabs(produce((t) => t.push(tab)))
        setPreviousID(activeID())
        setActiveID(id)
        if (navigator) navigator(tab.route)
      })
      return id
    },
    close(id) {
      if (tabs.length <= 1) return
      const idx = tabs.findIndex((t) => t.id === id)
      if (idx === -1) return
      const wasActive = activeID() === id
      batch(() => {
        setTabs(produce((t) => t.splice(idx, 1)))
        if (previousID() === id) setPreviousID(null)
        if (wasActive) {
          const nextIdx = Math.min(idx, tabs.length - 1)
          setActiveID(tabs[nextIdx].id)
          if (navigator) navigator(tabs[nextIdx].route)
        }
      })
    },
    activate(id) {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return
      const current = activeID()
      if (current === id) return
      batch(() => {
        setPreviousID(current)
        setActiveID(id)
        if (navigator) navigator(tab.route)
      })
    },
    last() {
      const prev = previousID()
      if (!prev) return
      const tab = tabs.find((t) => t.id === prev)
      if (!tab) return
      const current = activeID()
      batch(() => {
        setPreviousID(current)
        setActiveID(prev)
        if (navigator) navigator(tab.route)
      })
    },
    rename(id, label) {
      setTabs(
        (t) => t.id === id,
        produce((t) => {
          t.label = label
        }),
      )
    },
    updateRoute(id, route) {
      setTabs(
        (t) => t.id === id,
        produce((t) => {
          t.route = structuredClone(unwrap(route))
        }),
      )
    },
    updateSessionID(id, sessionID) {
      setTabs(
        (t) => t.id === id,
        produce((t) => {
          t.sessionID = sessionID
        }),
      )
    },
    updateDirectory(id, directory) {
      setTabs(
        (t) => t.id === id,
        produce((t) => {
          t.directory = directory
        }),
      )
    },
    _setNavigator(nav) {
      navigator = nav
    },
    previousID,
    position,
    setPosition(p) {
      setPositionRaw(p)
    },
    load(state) {
      batch(() => {
        setTabs(state.tabs)
        setActiveID(state.activeID)
        setPreviousID(state.previousID)
        setPositionRaw(state.position)
        const active = state.tabs.find((t) => t.id === state.activeID)
        if (active && navigator) navigator(active.route)
      })
    },
  }
  return result
}
