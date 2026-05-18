import type { Effect, Stream } from "effect"
import type { Interface as RequestExecutorInterface } from "../executor"
import type { Interface as WebSocketExecutorInterface } from "./websocket"
import type { LLMError, LLMRequest } from "../../schema"

export interface TransportRuntime {
  readonly http: RequestExecutorInterface
  readonly webSocket?: WebSocketExecutorInterface
}

export interface Transport<Body, Prepared, Frame> {
  readonly id: string
  readonly prepare: (body: Body, request: LLMRequest) => Effect.Effect<Prepared, LLMError>
  readonly frames: (
    prepared: Prepared,
    request: LLMRequest,
    runtime: TransportRuntime,
  ) => Stream.Stream<Frame, LLMError>
}

export * as HttpTransport from "./http"
export { WebSocketExecutor, WebSocketTransport } from "./websocket"
