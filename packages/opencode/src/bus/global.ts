import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

type GlobalBusEvents = {
  event: [GlobalEvent]
}

class GlobalBusEmitter extends EventEmitter<GlobalBusEvents> {
  override emit: EventEmitter<GlobalBusEvents>["emit"] = (eventName, ...args) => {
    const event = args[0]
    if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
      event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
    }
    return super.emit(eventName, ...args)
  }
}

export const GlobalBus = new GlobalBusEmitter()
