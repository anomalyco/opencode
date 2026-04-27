import { Cause, Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ProviderRequestError, TransportError, type LLMError } from "./schema"

export interface Interface {
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM/RequestExecutor") {}

const statusError = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    if (response.status < 400) return response
    const body = yield* response.text.pipe(Effect.catch(() => Effect.succeed(undefined)))
    return yield* new ProviderRequestError({
      status: response.status,
      message: `Provider request failed with HTTP ${response.status}`,
      body,
    })
  })

const toHttpError = (error: unknown) => {
  if (Cause.isTimeoutError(error)) return new TransportError({ message: error.message, reason: "Timeout" })
  if (!HttpClientError.isHttpClientError(error)) return new TransportError({ message: "HTTP transport failed" })
  const url = "request" in error ? error.request.url : undefined
  if (error.reason._tag === "TransportError") {
    return new TransportError({
      message: error.reason.description ?? "HTTP transport failed",
      reason: error.reason._tag,
      url,
    })
  }
  return new TransportError({
    message: `HTTP transport failed: ${error.reason._tag}`,
    reason: error.reason._tag,
    url,
  })
}

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    return Service.of({
      execute: (request) => http.execute(request).pipe(Effect.mapError(toHttpError), Effect.flatMap(statusError)),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))

export * as RequestExecutor from "./executor"
