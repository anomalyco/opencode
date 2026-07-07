import type { EventApi } from "@opencode-ai/client/promise/api"
import type { Hooks } from "./registration.js"

export interface EventHooks {}

export interface EventDomain extends Pick<EventApi, "subscribe"> {
  readonly hook: Hooks<EventHooks>
}
