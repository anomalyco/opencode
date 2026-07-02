export * as DurableEventManifest from "./durable-event-manifest.js"

import { Event } from "./event.js"
import { SessionEvent } from "./session-event.js"
import { SessionV1 } from "./session-v1.js"

export const SessionDurable = {
  definitions: Event.durable(SessionEvent.DurableDefinitions),
  schema: SessionEvent.Durable,
} as const

export const Durable = Event.durable([
  ...SessionV1.Event.Definitions.filter((definition) => definition.durable !== undefined),
  ...SessionEvent.DurableDefinitions,
])
