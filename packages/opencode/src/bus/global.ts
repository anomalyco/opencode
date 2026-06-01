import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

const bus = new EventEmitter<{
  event: [GlobalEvent]
}>()

export const GlobalBus = {
  emit(eventName: "event", event: GlobalEvent): boolean {
    if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
      event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
    }
    return bus.emit(eventName, event)
  },
  on(eventName: "event", listener: (event: GlobalEvent) => void) {
    return bus.on(eventName, listener)
  },
  off(eventName: "event", listener: (event: GlobalEvent) => void) {
    return bus.off(eventName, listener)
  },
}
