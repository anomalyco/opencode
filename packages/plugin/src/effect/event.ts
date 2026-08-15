import type { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import type { Stream } from "effect"

export type PluginEvent = Exclude<OpenCodeEvent, { readonly type: "server.connected" }>
export type EventTypes = readonly [PluginEvent["type"], ...PluginEvent["type"][]]
export type EventSelection = PluginEvent["type"] | EventTypes

export interface EventDomain {
  readonly subscribe: (selection?: EventSelection) => Stream.Stream<PluginEvent>
}
