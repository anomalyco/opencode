export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@moks/schema/event"
import { EventManifest } from "@moks/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
