import type { EventApi } from "@opencode-ai/client/promise/api"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"

export interface EventDomain extends Pick<EventApi, "subscribe"> {
  /**
   * Subscribe to the global (location-unfiltered) event stream. Unlike
   * `subscribe`, this delivers server and rpc events for every location, which
   * is needed by cross-location observers (e.g. a bot that streams sessions
   * from multiple directories). The stream is loss-tolerant: a slow consumer
   * drops buffered events rather than stalling publication. Drops are logged
   * with a cumulative count; consumers that need gap-free delivery must use
   * the durable `log`, not this live bridge.
   */
  readonly subscribeGlobal: (options?: { readonly signal?: AbortSignal }) => AsyncIterable<OpenCodeEvent>
}
