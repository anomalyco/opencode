import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
  workspaceID?: string
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

export type ParallelRoute = {
  type: "parallel"
  planID: string
  returnTo?: HomeRoute | SessionRoute // Track where to return when done
}

export type Route = HomeRoute | SessionRoute | ParallelRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [store, setStore] = createStore<Route>(
      process.env["OPENCODE_ROUTE"]
        ? JSON.parse(process.env["OPENCODE_ROUTE"])
        : {
            type: "home",
          },
    )
    // Track previous route for navigation back
    const [history, setHistory] = createStore<Route[]>([])

    return {
      get data() {
        return store
      },
      get previous() {
        return history.length > 0 ? history[history.length - 1] : null
      },
      navigate(route: Route) {
        console.log("navigate", route)
        // Store current route in history before navigating
        setHistory((prev) => [...prev, store])
        setStore(route)
      },
      goBack() {
        const prev = history[history.length - 1]
        if (prev) {
          setHistory((h) => h.slice(0, -1))
          setStore(prev)
        }
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
