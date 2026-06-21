import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

class GlobalBusEmitter extends EventEmitter<{
  event: [GlobalEvent]
}> {
  constructor() {
    super()
    // SSE connections (event.ts + global.ts) each register listeners via
    // acquireRelease. With multiple browser tabs, reconnects, and internal
    // consumers, the default limit of 10 is routinely exceeded. Set
    // explicitly to suppress MaxListenersExceededWarning and document the
    // expected concurrency.
    this.setMaxListeners(100)
  }

  override emit(eventName: "event", event: GlobalEvent): boolean {
    if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
      event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
    }
    return super.emit(eventName, event)
  }
}

export const GlobalBus = new GlobalBusEmitter()
