import type { OpenCodeEventEncoded } from "@opencode-ai/protocol/groups/event"

export type PluginEvent = Exclude<OpenCodeEventEncoded, { readonly type: "server.connected" }>
export type EventTypes = readonly [PluginEvent["type"], ...PluginEvent["type"][]]
export type EventSelection = PluginEvent["type"] | EventTypes

export interface EventDomain {
  readonly subscribe: (selection?: EventSelection) => AsyncIterable<PluginEvent>
}
