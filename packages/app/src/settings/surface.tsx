import { useLocation } from "@solidjs/router"
import { createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"

export const { use: useSettingsSurface, provider: SettingsSurfaceProvider } = createSimpleContext({
  name: "SettingsSurface",
  gate: false,
  init: () => {
    const location = useLocation()
    const [store, setStore] = createStore({ open: false, tab: "general" })
    let focus: HTMLElement | undefined

    const close = () => {
      if (!store.open) return
      setStore("open", false)
      if (focus?.isConnected) focus.focus({ preventScroll: true })
      focus = undefined
    }

    createEffect(on(() => `${location.pathname}${location.search}`, close, { defer: true }))

    return {
      store,
      open(tab = "general") {
        if (!store.open && document.activeElement instanceof HTMLElement) focus = document.activeElement
        setStore({ open: true, tab })
      },
      close,
    }
  },
})
