import { GlobalBus } from "./global"
import type { Event } from "./bus-event"

type Envelope<P> = {
  type: string
  properties: P
}

export namespace Bus {
  export async function publish<P>(event: Event<string, P>, properties: P): Promise<void> {
    GlobalBus.emit("event", {
      payload: {
        type: event.type,
        properties,
      },
    })
  }

  export function subscribe<P>(event: Event<string, P>, fn: (payload: Envelope<P>) => unknown | Promise<unknown>) {
    const handler = (input: { payload?: unknown }) => {
      if (!input.payload || typeof input.payload !== "object") return
      if (!("type" in input.payload) || input.payload.type !== event.type) return
      const properties = "properties" in input.payload ? (input.payload.properties as P) : undefined
      void fn({ type: event.type, properties: properties as P })
    }
    GlobalBus.on("event", handler)
    return () => GlobalBus.off("event", handler)
  }
}
