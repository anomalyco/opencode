import type { Event } from "@opencode-ai/sdk/v2"

export type SyncMessageEvent = Extract<
  Event,
  {
    type:
      | "message.updated"
      | "message.removed"
      | "message.part.updated"
      | "message.part.delta"
      | "message.part.removed"
  }
>

export function createSyncMessageEventBuffer() {
  const queue = new Map<string, SyncMessageEvent[]>()

  return {
    push(event: SyncMessageEvent) {
      const sessionID = event.properties.sessionID
      const events = queue.get(sessionID)
      if (events) {
        events.push(event)
        return
      }
      queue.set(sessionID, [event])
    },
    drain(sessionID: string) {
      const events = queue.get(sessionID) ?? []
      queue.delete(sessionID)
      return events
    },
    clear() {
      queue.clear()
    },
  }
}
