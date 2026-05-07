import type { Effect, Stream } from "effect"
import type { Interface as RequestExecutorInterface } from "../executor"
import type { Interface as WebSocketExecutorInterface } from "./websocket"
import type { LLMError, LLMRequest } from "../../schema"

export interface TransportContext {
  readonly request: LLMRequest
}

export interface TransportRuntime {
  readonly http: RequestExecutorInterface
  readonly webSocket?: WebSocketExecutorInterface
}

export interface Transport<Payload, Prepared, Frame> {
  readonly id: string
  readonly prepare: (payload: Payload, context: TransportContext) => Effect.Effect<Prepared, LLMError>
  readonly frames: (
    prepared: Prepared,
    context: TransportContext,
    runtime: TransportRuntime,
  ) => Stream.Stream<Frame, LLMError>
}

export * as HttpTransport from "./http"
export * as WebSocketExecutor from "./websocket"
