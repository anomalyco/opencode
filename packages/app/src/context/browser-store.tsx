import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createMemo } from "solid-js"
import { createStore, produce } from "solid-js/store"

export type BrowserEntry = {
  id: string
  url: string
  title: string
  visible: boolean
}

export type BrowserStore = {
  instances: Record<string, BrowserEntry>
  activeId: string | null
  panelOpen: boolean
}

export function getNextBrowserIdAfterClose(instances: Record<string, BrowserEntry>, activeId: string | null, closedId: string) {
  if (activeId !== closedId) return activeId
  const ids = Object.values(instances)
    .filter((instance) => instance.visible)
    .map((instance) => instance.id)
  const index = ids.indexOf(closedId)
  return ids[index + 1] ?? ids[index - 1] ?? null
}

function createBrowserStore(initial?: Partial<BrowserStore>) {
  const [store, setStore] = createStore<BrowserStore>({
    instances: initial?.instances ?? {},
    activeId: initial?.activeId ?? null,
    panelOpen: initial?.panelOpen ?? false,
  })

  return {
    store,
    activeBrowser: createMemo(() => (store.activeId ? (store.instances[store.activeId] ?? null) : null)),
    openPanel() {
      setStore("panelOpen", true)
    },
    closePanel() {
      setStore("panelOpen", false)
    },
    setActiveBrowser(id: string) {
      setStore("activeId", id)
    },
    addBrowser(id: string) {
      batch(() => {
        setStore("instances", id, { id, url: "", title: "", visible: true })
        setStore("activeId", id)
      })
    },
    removeBrowser(id: string) {
      const next = getNextBrowserIdAfterClose(store.instances, store.activeId, id)

      batch(() => {
        setStore(
          "instances",
          produce((instances) => {
            delete instances[id]
          }),
        )
        if (store.activeId === id) setStore("activeId", next)
      })
    },
    updateBrowser(id: string, patch: Partial<BrowserEntry>) {
      setStore("instances", id, (prev) => (prev ? { ...prev, ...patch } : prev))
    },
  }
}

export function createBrowserStoreForTest(initial?: Partial<BrowserStore>) {
  return createBrowserStore(initial)
}

export const { use: useBrowserStore, provider: BrowserProvider } = createSimpleContext({
  name: "Browser",
  gate: false,
  init: () => createBrowserStore(),
})
