import { Context, type Effect } from "effect"
import type { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import type { AIError } from "../schema/errors.js"

// The service tag lives in its own leaf module so `Media.Asset` (imported by the schema layer) can require the
// executor without pulling the full executor implementation, and therefore the schema barrel, into a cycle.
export interface Interface {
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest,
    middleware?: HttpMiddleware,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, AIError>
}

export type HttpHandler = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, Error>
export type HttpMiddleware = (
  request: HttpClientRequest.HttpClientRequest,
  handler: HttpHandler,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, Error>

export class RequestExecutorService extends Context.Service<RequestExecutorService, Interface>()(
  "@opencode/AI/RequestExecutor",
) {}
export const Service = RequestExecutorService
export type Service = RequestExecutorService
