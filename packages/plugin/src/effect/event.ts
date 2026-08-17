import type { EventApi } from "@opencode-ai/client/effect/api"
import type { OpenCodeEvent } from "@opencode-ai/client/effect"
import type { Stream } from "effect"

export type PluginEvent = Exclude<OpenCodeEvent, { readonly type: "server.connected" }>
export type PluginEventType = PluginEvent["type"]

export interface EventSubscribe {
  (): Stream.Stream<PluginEvent, unknown>
  (type: PluginEventType): Stream.Stream<PluginEvent, unknown>
}

export interface EventDomain extends Omit<EventApi<unknown>, "subscribe"> {
  readonly subscribe: EventSubscribe
}
