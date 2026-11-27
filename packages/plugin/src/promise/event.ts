import type { OpenCodeEvent } from "@opencode/client"
import type { SelectedEvent, SubscribeOptions } from "@opencode/client/promise/api"

// Space events go only to event stream subscribers of their space, never to plugins.
type EventType = Exclude<OpenCodeEvent["type"], "server.connected" | `experimental.space.${string}`>

export interface EventDomain {
  readonly subscribe: <Type extends EventType = EventType>(
    options?: SubscribeOptions<Type>,
  ) => AsyncIterable<SelectedEvent<OpenCodeEvent, Type>>
}
