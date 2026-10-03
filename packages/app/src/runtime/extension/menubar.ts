import { createContext, onCleanup, useContext } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Bridge, BridgeMenubarItem } from "@opencode/gui-extensions/sdk/bridge"

/** Native menubar items from main extensions, for the in-app menu on Windows and Linux. */
export function createMenubar(bridge: Bridge | undefined) {
  const [state, setState] = createStore({ items: [] as BridgeMenubarItem[] })
  if (bridge)
    onCleanup(
      bridge.on((message) => {
        if (message.type === "menubar") setState("items", reconcile([...message.items], { key: "id" }))
      }),
    )
  return {
    items: () => state.items,
    run: (id: string) => bridge?.menubar(id),
  }
}

const MenubarContext = createContext<ReturnType<typeof createMenubar>>()

export const ExtensionMenubarProvider = MenubarContext.Provider

export function useExtensionMenubar() {
  return useContext(MenubarContext)
}
