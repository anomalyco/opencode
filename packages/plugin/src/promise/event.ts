import type { EventApi } from "@opencode-ai/client/promise/api"

export interface EventDomain extends Pick<EventApi, "subscribe"> {}
