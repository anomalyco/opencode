import { Schema } from "effect"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { addPin, removePin } from "./pinned-list"

const PinnedMessagesSchema = Persistence.struct({
  // Session ID -> pinned message IDs, newest first.
  sessions: Persistence.record(Schema.Array(Schema.String)),
})

export type SessionPins = ReturnType<typeof createSessionPins>

/**
 * Pins are a personal, client-local view of a session, so they live in global storage rather than on the server.
 * Each session keeps its own list, newest first.
 */
export function createSessionPins() {
  const [store, setStore, , ready] = persisted(Persist.global("session-pins"), PinnedMessagesSchema, {
    sessions: {},
  })

  const list = (sessionID: string): readonly string[] => store.sessions[sessionID] ?? []

  const isPinned = (sessionID: string, messageID: string) => list(sessionID).includes(messageID)

  const pin = (sessionID: string, messageID: string) => {
    setStore("sessions", sessionID, addPin(list(sessionID), messageID))
  }

  const unpin = (sessionID: string, messageID: string) => {
    setStore("sessions", sessionID, removePin(list(sessionID), messageID))
  }

  return { ready, list, isPinned, pin, unpin }
}
