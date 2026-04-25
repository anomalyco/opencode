import { Cause, Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { TransportError, type LLMError, type TransportRequest } from "./schema"

export interface Interface {
  readonly fetch: (request: TransportRequest) => Effect.Effect<HttpClientResponse.HttpClientResponse, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM/Transport") {}

const toRequest = (request: TransportRequest) =>
  HttpClientRequest.post(request.url).pipe(
    HttpClientRequest.setHeaders(request.headers),
    HttpClientRequest.bodyText(request.body, request.headers["content-type"]),
  )

const toTransportError = (error: unknown) => {
  if (Cause.isTimeoutError(error)) return new TransportError({ message: error.message })
  if (!HttpClientError.isHttpClientError(error)) return new TransportError({ message: "HTTP transport failed" })
  if (error.reason._tag === "TransportError") {
    return new TransportError({ message: error.reason.description ?? "HTTP transport failed" })
  }
  return new TransportError({ message: `HTTP transport failed: ${error.reason._tag}` })
}

const withTimeout = <A, E, R>(effect: Effect.Effect<A, E, R>, request: TransportRequest) =>
  request.timeoutMs === undefined ? effect : effect.pipe(Effect.timeout(request.timeoutMs))

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return Service.of({
      fetch: (request) =>
        Effect.gen(function* () {
          return yield* withTimeout(http.execute(toRequest(request)), request)
        }).pipe(Effect.mapError(toTransportError)),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))

export * as Transport from "./transport"
