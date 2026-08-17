import type { OpenCodeEvent } from "@opencode-ai/client"
import type { EventApi } from "@opencode-ai/client/promise/api"

export type PluginEvent = Exclude<OpenCodeEvent, { readonly type: "server.connected" }>
export type PluginEventType = PluginEvent["type"]

export interface EventSubscribe {
  (): AsyncIterable<PluginEvent>
  (type: PluginEventType): AsyncIterable<PluginEvent>
}

export interface EventDomain extends Omit<EventApi, "subscribe"> {
  readonly subscribe: EventSubscribe
}
