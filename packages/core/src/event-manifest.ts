export * as EventManifest from "./event-manifest"

import { Event } from "@opencode-ai/schema/event"
import { SessionEvent } from "./session/event"
import { SessionV1 } from "./v1/session"

export const Definitions = Event.inventory(...SessionV1.Events, ...SessionEvent.Definitions)
export const Latest = Event.latest(Definitions)
export const Durable = Event.durable(Definitions)
