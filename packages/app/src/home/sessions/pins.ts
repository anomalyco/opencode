import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import type { ServerConnection } from "@/runtime/server/registry"

export const HomeSessionPinsSchema = Schema.Struct({
  pinned: Persistence.record(Persistence.array(Schema.String)),
})

/**
 * Pinned Home sessions, kept per server so two servers cannot collide on a
 * session ID. This is client UI state, not session data: pinning never mutates
 * the session and never changes its server-side order.
 */
export function createHomeSessionPins() {
  const [store, setStore, , ready] = persisted(Persist.global("home.sessions.pinned"), HomeSessionPinsSchema, {
    pinned: {},
  })

  const ids = (server: ServerConnection.Key) => store.pinned[server] ?? []

  return {
    ready,
    ids,
    isPinned: (server: ServerConnection.Key, sessionID: string) => ids(server).includes(sessionID),
    toggle(server: ServerConnection.Key, sessionID: string) {
      const current = ids(server)

      setStore(
        "pinned",
        server,
        current.includes(sessionID) ? current.filter((id) => id !== sessionID) : [...current, sessionID],
      )
    },
    remove(server: ServerConnection.Key, sessionID: string) {
      const current = ids(server)

      if (!current.includes(sessionID)) return
      setStore(
        "pinned",
        server,
        current.filter((id) => id !== sessionID),
      )
    },
  }
}
