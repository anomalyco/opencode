import { createSimpleContext } from "@opencode/ui/context"
import { Schema } from "effect"
import { reconcile } from "solid-js/store"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import type { ServerConnection } from "@/runtime/server/registry"

// Session IDs per server, in the order they were pinned.
export const PinnedSessions = Persistence.record(Persistence.array(Schema.String))

export type PinnedSessions = typeof PinnedSessions.Type

export function pinnedIDs(pins: PinnedSessions, server: ServerConnection.Key) {
  return pins[server] ?? []
}

export function isPinned(pins: PinnedSessions, server: ServerConnection.Key, sessionID: string) {
  return pinnedIDs(pins, server).includes(sessionID)
}

export function withPin(pins: PinnedSessions, server: ServerConnection.Key, sessionID: string) {
  const ids = pinnedIDs(pins, server)

  if (ids.includes(sessionID)) return pins

  return { ...pins, [server]: [...ids, sessionID] }
}

export function withoutPins(pins: PinnedSessions, server: ServerConnection.Key, sessionIDs: readonly string[]) {
  const current = pinnedIDs(pins, server)
  const ids = current.filter((id) => !sessionIDs.includes(id))

  if (ids.length === current.length) return pins

  if (ids.length > 0) return { ...pins, [server]: ids }

  const next = { ...pins }

  delete next[server]

  return next
}

export const { use: useSessionPins, provider: SessionPinsProvider } = createSimpleContext({
  name: "SessionPins",
  gate: false,
  init: () => {
    const [store, setStore] = persisted(Persist.global("home.sessions.pinned"), PinnedSessions, {})

    return {
      ids: (server: ServerConnection.Key) => pinnedIDs(store, server),
      pinned: (server: ServerConnection.Key, sessionID: string) => isPinned(store, server, sessionID),
      toggle(server: ServerConnection.Key, sessionID: string) {
        setStore(
          reconcile(
            isPinned(store, server, sessionID)
              ? withoutPins(store, server, [sessionID])
              : withPin(store, server, sessionID),
          ),
        )
      },
      forget(server: ServerConnection.Key, sessionIDs: readonly string[]) {
        setStore(reconcile(withoutPins(store, server, sessionIDs)))
      },
    }
  },
})
