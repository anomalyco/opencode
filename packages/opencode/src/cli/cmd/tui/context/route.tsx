import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export type HomeRoute = {
  type: "home"
}

export type SessionRoute = {
  type: "session"
  sessionID: string
}

export type Route = HomeRoute | SessionRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: (props: { data?: Route }) => {
    const [store, setStore] = createStore<Route>(
      props.data ??
        (process.env["OPENCODE_ROUTE"]
          ? JSON.parse(process.env["OPENCODE_ROUTE"])
          : {
              type: "home",
            }),
    )

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
