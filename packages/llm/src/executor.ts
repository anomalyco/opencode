import { Cause, Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { TransportError, type LLMError } from "./schema"

export interface Interface {
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM/RequestExecutor") {}

const toHttpError = (error: unknown) => {
  if (Cause.isTimeoutError(error)) return new TransportError({ message: error.message })
  if (!HttpClientError.isHttpClientError(error)) return new TransportError({ message: "HTTP transport failed" })
  if (error.reason._tag === "TransportError") {
    return new TransportError({ message: error.reason.description ?? "HTTP transport failed" })
  }
  return new TransportError({ message: `HTTP transport failed: ${error.reason._tag}` })
}

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    return Service.of({
      execute: (request) => http.execute(request).pipe(Effect.mapError(toHttpError)),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))

export * as RequestExecutor from "./executor"
