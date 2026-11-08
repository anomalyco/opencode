import type { OpenCodeEvent } from "@Mackery6969/client"
import type { SelectedEvent, SubscribeOptions } from "@Mackery6969/client/promise/api"

type EventType = Exclude<OpenCodeEvent["type"], "server.connected">

export interface EventDomain {
  readonly subscribe: <Type extends EventType = EventType>(
    options?: SubscribeOptions<Type>,
  ) => AsyncIterable<SelectedEvent<OpenCodeEvent, Type>>
}
