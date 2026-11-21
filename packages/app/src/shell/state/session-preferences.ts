import { Schema } from "effect"
import { createMemo } from "solid-js"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useServers } from "@/runtime/server/registry"
import {
  recentSessionEndpoints,
  recentSessionKey,
  removePin,
  splitRecentSessionKey,
} from "@/shell/titlebar/recent-sessions-model"

const Preferences = Persistence.struct({
  hidden: Persistence.array(Schema.String),
  muted: Persistence.array(Schema.String),
})

export function createSessionPreferences() {
  const servers = useServers()
  const endpoints = createMemo(() => recentSessionEndpoints(servers.list, servers.ownUrl()))

  const [state, set, , ready] = persisted({ ...Persist.global("session.preferences"), sync: true }, Preferences, {
    hidden: [],
    muted: [],
  })

  const key = (server: string, id: string) => recentSessionKey(endpoints().get(server) ?? server, id)

  const identities = (stored: readonly string[]) =>
    new Set(stored.map((value) => {
      const session = splitRecentSessionKey(value)

      return session ? key(session.server, session.sessionID) : value
    }))

  const keys = {
    hidden: createMemo(() => identities(state.hidden)),
    muted: createMemo(() => identities(state.muted)),
  }

  const update = (kind: keyof typeof keys, server: string, id: string, enabled: boolean) => {
    const apply = () => {
      if (keys[kind]().has(key(server, id)) === enabled) return
      const value = recentSessionKey(server, id)
      set(kind, (current) => (enabled ? [...current, value] : removePin(current, value, endpoints())))
    }

    if (ready()) return apply()
    void ready.promise?.then(apply)
  }

  return {
    ready,
    hidden: (server: string, id: string) => keys.hidden().has(key(server, id)),
    muted: (server: string, id: string) => keys.muted().has(key(server, id)),
    update,
    forget(server: string, id: string) {
      update("hidden", server, id, false)
      update("muted", server, id, false)
    },
  }
}
