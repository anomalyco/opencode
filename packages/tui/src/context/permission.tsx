import { createStore } from "solid-js/store"
import { createEffect } from "solid-js"
import { useConfig } from "../config"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"

export type PermissionMode = "prompt" | "autoaccept"

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const config = useConfig()
    const [store, setStore] = createStore<{ mode: PermissionMode; configured: PermissionMode }>({
      mode: args.auto ? "autoaccept" : config.data.session.permissions,
      configured: config.data.session.permissions,
    })
    createEffect(() => {
      const mode = config.data.session.permissions
      if (mode === store.configured) return
      setStore({ mode, configured: mode })
    })
    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        setStore("mode", mode)
        return config.update((draft) => {
          draft.session = { ...draft.session, permissions: mode }
        })
      },
      toggle() {
        return this.set(store.mode === "autoaccept" ? "prompt" : "autoaccept")
      },
    }
  },
})
