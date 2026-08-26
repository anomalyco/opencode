import { useBeforeLeave, useLocation, useNavigate } from "@solidjs/router"
import { createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { usePlatform } from "@/runtime/platform/platform"
import { applyPath, type TitlebarAction, type TitlebarHistory } from "./history"

export function createTitlebarHistory(input: { storage?: Storage; restore?: boolean } = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const path = () => `${location.pathname}${location.search}${location.hash}`
  const state = createStore<TitlebarHistory>({ stack: [], index: 0 })
  const [store, setStore] = input.storage
    ? makePersisted(state, { storage: input.storage, name: "opencode.navigation-history" })
    : state
  if (!input.restore || !Array.isArray(store.stack) || store.stack[store.index] !== path()) {
    setStore({ stack: [], index: 0 })
  }
  let action: TitlebarAction | undefined

  useBeforeLeave((event) => {
    action = typeof event.to === "number" ? event.to : { replace: event.options?.replace }
  })

  createEffect(
    on(path, (path) => {
      setStore(applyPath(store, path, action))
      action = undefined
    }),
  )

  const go = (delta: number) => {
    if (!store.stack[store.index + delta]) return false
    // Set the intent ourselves as MemoryRouter.go bypasses useBeforeLeave.
    action = delta
    navigate(delta)
    return true
  }

  return {
    back() {
      if (!go(-1) && location.pathname !== "/") navigate("/", { replace: true })
    },
    forward() {
      go(1)
    },
  }
}

export const { use: useTitlebarHistory, provider: TitlebarHistoryProvider } = createSimpleContext({
  name: "TitlebarHistory",
  init: () => {
    const platform = usePlatform()
    // Browser history survives reload; desktop recreates its MemoryRouter with one entry.
    return createTitlebarHistory(
      platform.platform === "web"
        ? {
            storage: sessionStorage,
            restore: performance
              .getEntriesByType("navigation")
              .some((entry) => entry instanceof PerformanceNavigationTiming && entry.type === "reload"),
          }
        : undefined,
    )
  },
})
