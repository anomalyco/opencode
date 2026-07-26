import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"
import { startupPermissionMode } from "../mode-cycle"

export type PermissionMode = "auto" | "normal"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const [store, setStore] = createStore<{ mode: PermissionMode; revision: number }>({
      mode: startupPermissionMode(args),
      revision: 0,
    })
    return {
      get mode() {
        return store.mode
      },
      get revision() {
        return store.revision
      },
      set(mode: PermissionMode) {
        if (store.mode === mode) return
        setStore({ mode, revision: store.revision + 1 })
      },
    }
  },
})
