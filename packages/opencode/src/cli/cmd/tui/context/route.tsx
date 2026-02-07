import { createContext, useContext } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

export type Route = HomeRoute | SessionRoute

const DriverCtx = createContext<{
  data: Route
  navigate: (route: Route) => void
}>()

export function useRouteDriver() {
  return useContext(DriverCtx)
}

export { DriverCtx as RouteDriverContext }

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const driver = useContext(DriverCtx)

    const [store, setStore] = createStore<Route>(
      process.env["OPENCODE_ROUTE"]
        ? JSON.parse(process.env["OPENCODE_ROUTE"])
        : {
            type: "home",
          },
    )

    if (driver) {
      return {
        get data() {
          return driver.data
        },
        navigate(route: Route) {
          console.log("navigate", route)
          driver.navigate(route)
        },
      }
    }

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        console.log("navigate", route)
        setStore(route)
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
