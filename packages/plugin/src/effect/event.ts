import type { EventSubscribeInput, EventSubscribeOutput, SelectedEvent } from "@opencode/client/effect/api"
import type { Stream } from "effect"

type EventType = NonNullable<EventSubscribeInput["types"]>[number]

export interface EventDomain {
  readonly subscribe: <Type extends EventType = EventType>(input?: {
    readonly types?: ReadonlyArray<Type>
  }) => Stream.Stream<SelectedEvent<EventSubscribeOutput, Type>, unknown>
}
