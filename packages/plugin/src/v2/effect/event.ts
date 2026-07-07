import type { EventApi } from "@opencode-ai/client/effect/api"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {}
