import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../prompt/history"
import { useTuiStartup } from "./runtime"

export type HomeRoute = {
  type: "home"
  prompt?: PromptInfo
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  prompt?: PromptInfo
}

export type PluginRoute = {
  type: "plugin"
  id: string
  data?: Record<string, unknown>
}

export type Route = HomeRoute | SessionRoute | PluginRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: (props: { initialRoute?: Route; onActiveSession?: (sessionID: string) => void }) => {
    const startup = useTuiStartup()
    const initial = props.initialRoute ?? initialRoute(startup.initialRoute) ?? { type: "home" }
    const [store, setStore] = createStore<Route>(initial)
    if (initial.type === "session") {
      const sessionID = nextActiveSession(undefined, initial)
      if (sessionID) queueMicrotask(() => props.onActiveSession?.(sessionID))
    }

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        const sessionID = nextActiveSession(store, route)
        setStore(reconcile(route))
        if (sessionID) props.onActiveSession?.(sessionID)
      },
    }
  },
})

export function nextActiveSession(prev: Route | undefined, next: Route): string | undefined {
  if (next.type !== "session") return undefined
  if (prev?.type === "session" && prev.sessionID === next.sessionID) return undefined
  return next.sessionID
}

function initialRoute(value: unknown): Route | undefined {
  if (!value || typeof value !== "object" || !("type" in value)) return
  if (value.type === "home") return { type: "home" }
  if (value.type === "session" && "sessionID" in value && typeof value.sessionID === "string") {
    return { type: "session", sessionID: value.sessionID }
  }
  if (value.type === "plugin" && "id" in value && typeof value.id === "string") {
    return { type: "plugin", id: value.id }
  }
}

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
