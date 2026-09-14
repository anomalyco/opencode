import type { EventApi } from "@opencode/client/promise/api"

export interface EventDomain extends Pick<EventApi, "subscribe"> {}
