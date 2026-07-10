export * as DurableEventManifest from "./durable-event-manifest.js"

import { Event } from "./event.js"
import { SessionEvent } from "./session-event.js"
import { SessionV1 } from "./session-v1.js"

export const SessionDurable = {
  definitions: Event.durableMap(SessionEvent.DurableDefinitions),
  schema: SessionEvent.Durable,
} as const

export const Durable = Event.durableMap([...SessionV1.Event.Definitions, ...SessionEvent.DurableDefinitions])
