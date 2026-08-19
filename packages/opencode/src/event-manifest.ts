export * as EventManifest from "./event-manifest"

import { Event } from "@opencode-ai/schema/event"
import { Definitions as SchemaDefinitions, Durable } from "@opencode-ai/schema/event-manifest"
import { Loop } from "@/loop/loop"
import { SideQuestion } from "@/side-question"

// fork: loop and side-question are fork-owned services that publish EventV2
// events and own HTTP routes. Their definitions live in packages/opencode (they
// reference fork-only schemas), so they cannot be declared in the shared schema
// manifest — they are appended here instead. Without this the events are absent
// from the generated `Event` union, and every client (TUI included) loses the
// ability to subscribe to `loop.updated`.
export const Definitions = Event.inventory(
  ...SchemaDefinitions,
  ...Event.inventory(Loop.Event.Updated, SideQuestion.Event.Response),
)

export const Latest = Event.latest(Definitions)
export { Durable }
