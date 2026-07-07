import type { EventApi } from "@opencode-ai/client/effect/api"
import type { Hooks } from "./registration.js"

export interface EventHooks {}

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {
  readonly hook: Hooks<EventHooks>
}
