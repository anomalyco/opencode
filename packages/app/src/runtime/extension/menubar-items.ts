import { createContext, onCleanup, useContext } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Bridge, BridgeMenubarItem } from "@opencode/gui-extensions/sdk/bridge"

/** MenubarItem contributions from main extensions, for the in-app menu on Windows and Linux. */
export function createMenubarItems(bridge: Bridge | undefined) {
  const [state, setState] = createStore<{ items: BridgeMenubarItem[] }>({ items: [] })

  if (bridge)
    onCleanup(
      bridge.on((message) => {
        if (message.type === "menubarItems") setState("items", reconcile([...message.items], { key: "id" }))
      }),
    )

  return {
    items: () => state.items,
    run: (id: string) => bridge?.runMenubarItem(id),
  }
}

const MenubarItemsContext = createContext<ReturnType<typeof createMenubarItems>>()

export const MenubarItemsProvider = MenubarItemsContext.Provider

export function useMenubarItems() {
  return useContext(MenubarItemsContext)
}
