import type { EventApi } from "@opencode-ai/client/effect/api"
import type { Event } from "@opencode-ai/schema/event"
import type { Stream } from "effect"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {
  /**
   * Subscribe to the global (location-unfiltered) event stream. Unlike
   * `subscribe`, this delivers server and rpc events for every location, which
   * is needed by cross-location observers (e.g. a bot that streams sessions
   * from multiple directories). The stream is loss-tolerant: a slow consumer
   * drops buffered events rather than stalling publication.
   */
  readonly subscribeGlobal: () => Stream.Stream<Event.Payload>
}
