import type { TuiRouteDefinition } from "@opencode-ai/plugin/v1/tui"
import { createSignal } from "solid-js"

type RouteEntry = {
  key: symbol
  render: TuiRouteDefinition["render"]
}

export type RouteMap = Map<string, RouteEntry[]>

export function createPluginRoutes() {
  const routes: RouteMap = new Map()
  const [revision, setRevision] = createSignal(0)

  return {
    register(list: TuiRouteDefinition[]) {
      const key = Symbol()
      list.forEach((item) => routes.set(item.name, [...(routes.get(item.name) ?? []), { key, render: item.render }]))
      setRevision((value) => value + 1)

      return () => {
        list.forEach((item) => {
          const next = routes.get(item.name)?.filter((entry) => entry.key !== key) ?? []
          if (next.length) {
            routes.set(item.name, next)
            return
          }
          routes.delete(item.name)
        })
        setRevision((value) => value + 1)
      }
    },
    get(name: string) {
      revision()
      return routes.get(name)?.at(-1)?.render
    },
  }
}

export type PluginRoutes = ReturnType<typeof createPluginRoutes>
