import { createEffect, createMemo, on, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { ComposerTab } from "./context"

const order = ["subagents", "shell", "scripts", "terminals"]

const rank = (id: string) => {
  const index = order.indexOf(id)
  return index < 0 ? order.length : index
}

// The picker's tabs in a fixed order, and which one is active. Tabs that come and go while it is open, like Scripts,
// leave the active tab alone unless they remove it.
export function createComposerTabs(input: { open: () => boolean; defaultTab: () => string | undefined }) {
  const [store, setStore] = createStore({
    tabs: {} as Record<string, ComposerTab>,
    active: "",
  })

  const list = createMemo(() => Object.values(store.tabs).toSorted((a, b) => rank(a.id) - rank(b.id)))

  const pick = (tabs: ComposerTab[]) => {
    const defaultTab = input.defaultTab()
    const match = defaultTab && tabs.find((tab) => tab.id === defaultTab)
    setStore("active", match ? match.id : tabs[0].id)
  }

  createEffect(
    on(
      () => [input.open(), input.defaultTab()] as const,
      ([open]) => {
        const tabs = untrack(list)
        if (open && tabs.length > 0) pick(tabs)
      },
    ),
  )

  createEffect(() => {
    const tabs = list()
    if (!input.open() || tabs.length === 0 || tabs.some((tab) => tab.id === store.active)) return
    pick(tabs)
  })

  return {
    list,
    active: () => store.active,
    setActive: (id: string) => setStore("active", id),
    register(tab: ComposerTab) {
      setStore("tabs", tab.id, tab)
      if (!store.active) setStore("active", tab.id)
      return () => setStore("tabs", tab.id, undefined!)
    },
  }
}
