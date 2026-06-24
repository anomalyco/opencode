import { ServerConnection } from "@/context/server"

export type SessionPlacement = {
  rootID: string
  directory: string
}

export function createSessionPlacementStore() {
  const placements = new Map<string, SessionPlacement>()
  const limit = 256
  const key = (server: ServerConnection.Key, sessionID: string) => `${server}\0${sessionID}`
  const write = (id: string, placement: SessionPlacement) => {
    placements.delete(id)
    placements.set(id, placement)
    while (placements.size > limit) placements.delete(placements.keys().next().value!)
  }

  return {
    get(server: ServerConnection.Key, sessionID: string) {
      const id = key(server, sessionID)
      const placement = placements.get(id)
      if (placement) write(id, placement)
      return placement
    },
    set(input: SessionPlacement & { server: ServerConnection.Key; leafID: string }) {
      const placement = { rootID: input.rootID, directory: input.directory }
      write(key(input.server, input.leafID), placement)
      write(key(input.server, input.rootID), placement)
      return placement
    },
    inherit(server: ServerConnection.Key, sourceID: string, leafID: string) {
      const placement = placements.get(key(server, sourceID))
      if (!placement) return
      write(key(server, leafID), placement)
      return placement
    },
    size() {
      return placements.size
    },
  }
}
