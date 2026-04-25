import type { Effect } from "effect"
import type { LLMError, TransportRequest } from "./schema"

export interface Transport {
  readonly fetch: (request: TransportRequest) => Effect.Effect<Response, LLMError>
}

export * as LLMCoreTransport from "./transport"
