import type { EventApi } from "@opencode/client/effect/api"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {}
