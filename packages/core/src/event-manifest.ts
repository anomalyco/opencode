export * as EventManifest from "./event-manifest"

import { Event } from "@opencode-ai/schema/event"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionV1 } from "@opencode-ai/schema/session-v1"

export const Definitions = Event.inventory(...SessionV1.Events, ...SessionEvent.Definitions)
export const Latest = Event.latest(Definitions)
export const Durable = Event.durable(Definitions)
