export * as McpToggles from "./toggles.js"

import type { Mcp } from "@opencode/schema/mcp"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Layer } from "effect"
import type { Location } from "../location.js"

export interface Toggle {
  readonly enabled: boolean
  /** The server's config when the toggle was made. A Location that boots with other config ignores the toggle. */
  readonly config: Mcp.ServerConfig
}

export interface Interface {
  /**
   * The servers a Location's `connect` or `disconnect` turned on or off, by name. A host keeps this node in its
   * application graph so the choices outlive the Location: an evicted Location rebuilds from config alone.
   */
  readonly forLocation: (location: Location.Interface) => Map<string, Toggle>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpToggles") {}

export const layer = Layer.sync(Service, () => {
  const locations = new Map<string, Map<string, Toggle>>()
  return Service.of({
    forLocation: (location) => {
      const key = `${location.directory}\0${location.workspaceID ?? ""}`
      const existing = locations.get(key)
      if (existing) return existing
      const toggles = new Map<string, Toggle>()
      locations.set(key, toggles)
      return toggles
    },
  })
})

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
