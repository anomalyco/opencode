export * as McpToggles from "./toggles.js"

import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Layer } from "effect"
import type { Location } from "../location.js"

export interface Interface {
  /**
   * The servers a Location's `connect` or `disconnect` turned on (true) or off (false), by name. Kept for the
   * life of the process so the choice outlives the Location: an evicted Location rebuilds from config alone.
   */
  readonly forLocation: (location: Location.Interface) => Map<string, boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpToggles") {}

export const layer = Layer.sync(Service, () => {
  const locations = new Map<string, Map<string, boolean>>()
  return Service.of({
    forLocation: (location) => {
      const key = `${location.directory}\0${location.workspaceID ?? ""}`
      const existing = locations.get(key)
      if (existing) return existing
      const toggles = new Map<string, boolean>()
      locations.set(key, toggles)
      return toggles
    },
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
