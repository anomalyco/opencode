export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@leak-code/schema/event"
import { EventManifest } from "@leak-code/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
