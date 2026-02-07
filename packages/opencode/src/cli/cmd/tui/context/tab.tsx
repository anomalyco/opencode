import { batch, createMemo } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { Route } from "./route"

export type Tab = {
  id: string
  route: Route
}

let counter = 0
function id() {
  return "tab_" + counter++
}

export const { use: useTab, provider: TabProvider } = createSimpleContext({
  name: "Tab",
  init: () => {
    const first = id()
    const [store, setStore] = createStore<{
      tabs: Tab[]
      active: string
    }>({
      tabs: [{ id: first, route: { type: "home" } }],
      active: first,
    })

    const active = createMemo(() => store.tabs.find((t) => t.id === store.active)!)
    const idx = createMemo(() => store.tabs.findIndex((t) => t.id === store.active))

    return {
      get tabs() {
        return store.tabs
      },
      get active() {
        return active()
      },
      get index() {
        return idx()
      },
      navigate(route: Route) {
        setStore("tabs", idx(), "route", reconcile(route))
      },
      create(route?: Route) {
        const tab: Tab = { id: id(), route: route ?? { type: "home" } }
        batch(() => {
          setStore(
            "tabs",
            produce((tabs) => {
              tabs.splice(idx() + 1, 0, tab)
            }),
          )
          setStore("active", tab.id)
        })
        return tab
      },
      close(tabID?: string) {
        const target = tabID ?? store.active
        if (store.tabs.length <= 1) return
        const i = store.tabs.findIndex((t) => t.id === target)
        if (i === -1) return
        batch(() => {
          if (store.active === target) {
            const next = i < store.tabs.length - 1 ? store.tabs[i + 1].id : store.tabs[i - 1].id
            setStore("active", next)
          }
          setStore(
            "tabs",
            produce((tabs) => {
              tabs.splice(i, 1)
            }),
          )
        })
      },
      select(tabID: string) {
        if (store.tabs.some((t) => t.id === tabID)) {
          setStore("active", tabID)
        }
      },
      selectIndex(i: number) {
        if (i >= 0 && i < store.tabs.length) {
          setStore("active", store.tabs[i].id)
        }
      },
      next() {
        const i = idx()
        const next = (i + 1) % store.tabs.length
        setStore("active", store.tabs[next].id)
      },
      prev() {
        const i = idx()
        const prev = (i - 1 + store.tabs.length) % store.tabs.length
        setStore("active", store.tabs[prev].id)
      },
    }
  },
})
