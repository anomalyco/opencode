import type { ACPTools } from "./types"

export namespace ACPToolRegistry {
  const registry = new Map<string, ACPTools>()

  export function set(sessionID: string, tools: ACPTools) {
    registry.set(sessionID, tools)
  }

  export function get(sessionID: string): ACPTools | undefined {
    return registry.get(sessionID)
  }
}
