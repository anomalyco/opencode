import type { Effect, Stream } from "effect"
import { Endpoint } from "../endpoint.js"
import { Auth } from "../auth.js"
import type { HttpMiddleware, Interface as RequestExecutorInterface } from "../executor.js"
import type { Interface as WebSocketExecutorInterface } from "./websocket.js"
import type { AIError, LLMRequest } from "../../schema/index.js"

export interface TransportRuntime {
  readonly http: RequestExecutorInterface
  readonly webSocket?: WebSocketExecutorInterface
}

export interface Transport<Body, Prepared, Frame> {
  readonly id: string
  readonly prepare: (input: TransportPrepareInput<Body>) => Effect.Effect<Prepared, AIError>
  readonly frames: (prepared: Prepared, request: LLMRequest, runtime: TransportRuntime) => Stream.Stream<Frame, AIError>
}

export interface TransportPrepareInput<Body> {
  readonly body: Body
  readonly request: LLMRequest
  readonly endpoint: Endpoint.Definition<Body>
  readonly auth: Auth.Definition
  readonly encodeBody: (body: Body) => string
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  readonly middleware?: HttpMiddleware
}

export * as HttpTransport from "./http.js"
export type { HttpHandler, HttpMiddleware } from "../executor.js"
export { WebSocketExecutor, WebSocketTransport } from "./websocket.js"
