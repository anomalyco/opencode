import type { Event, GlobalEvent } from "@opencode-ai/sdk/v2"
import { useSDK } from "./sdk"

export type EventMetadata = Pick<GlobalEvent, "directory" | "workspace">

export function useEvent() {
  const sdk = useSDK()

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      // Reuse the GlobalEvent envelope as metadata; avoids a per-event allocation.
      handler(event.payload, event)
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: Event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}
