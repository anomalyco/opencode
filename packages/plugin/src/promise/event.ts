import type { OpenCodeEvent } from "@opencode/client"
import type { SelectedEvent, SubscribeOptions } from "@opencode/client/promise/api"

type EventType = Exclude<OpenCodeEvent["type"], "server.connected">

export interface EventDomain {
  readonly subscribe: <Type extends EventType = EventType>(
    options?: SubscribeOptions<Type>,
  ) => AsyncIterable<SelectedEvent<OpenCodeEvent, Type>>
}
