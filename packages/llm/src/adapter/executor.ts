import { Cause, Context, Effect, Layer } from "effect"
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import {
  HttpRequestDetails,
  HttpResponseDetails,
  ProviderRequestError,
  TransportError,
  type LLMError,
} from "../schema"

export interface Interface {
  readonly execute: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM/RequestExecutor") {}

const BODY_LIMIT = 16_384
const MAX_RETRIES = 2
const MAX_DELAY_MS = 10_000
const REDACTED = "<redacted>"

const sensitiveName = (name: string) =>
  /authorization|api[-_]?key|token|secret|credential|signature|x-amz-signature/i.test(name)

const redactHeaders = (headers: Headers.Headers) =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      sensitiveName(name) ? REDACTED : value,
    ]),
  )

const redactUrl = (value: string) => {
  if (!URL.canParse(value)) return REDACTED
  const url = new URL(value)
  url.searchParams.forEach((_, key) => {
    if (sensitiveName(key)) url.searchParams.set(key, REDACTED)
  })
  return url.toString()
}

const normalizedHeaders = (headers: Headers.Headers) =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))

const requestId = (headers: Record<string, string>) => {
  return headers["x-request-id"] ??
    headers["request-id"] ??
    headers["x-amzn-requestid"] ??
    headers["x-amz-request-id"] ??
    headers["x-goog-request-id"] ??
    headers["cf-ray"]
}

const retryableStatus = (status: number) => status === 429 || status === 503 || status === 504 || status === 529

const retryAfterMs = (headers: Record<string, string>) => {
  const millis = Number(headers["retry-after-ms"])
  if (Number.isFinite(millis)) return Math.max(0, millis)

  const value = headers["retry-after"]
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

const requestDetails = (request: HttpClientRequest.HttpClientRequest) =>
  new HttpRequestDetails({
    method: request.method,
    url: redactUrl(request.url),
    headers: redactHeaders(request.headers),
  })

const responseDetails = (response: HttpClientResponse.HttpClientResponse) =>
  new HttpResponseDetails({
    status: response.status,
    headers: redactHeaders(response.headers),
  })

const responseBody = (body: string | void) => {
  if (body === undefined) return {}
  if (body.length <= BODY_LIMIT) return { body }
  return { body: body.slice(0, BODY_LIMIT), bodyTruncated: true }
}

const statusError = (request: HttpClientRequest.HttpClientRequest) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    Effect.gen(function* () {
      if (response.status < 400) return response
      const body = yield* response.text.pipe(Effect.catch(() => Effect.void))
      const headers = normalizedHeaders(response.headers)
      const retryable = retryableStatus(response.status)
      return yield* new ProviderRequestError({
        status: response.status,
        message: `Provider request failed with HTTP ${response.status}`,
        ...responseBody(body),
        retryable,
        retryAfterMs: retryAfterMs(headers),
        requestId: requestId(headers),
        request: requestDetails(request),
        response: responseDetails(response),
      })
    })

const toHttpError = (error: unknown) => {
  if (Cause.isTimeoutError(error)) {
    return new TransportError({ message: error.message, reason: "Timeout", retryable: false })
  }
  if (!HttpClientError.isHttpClientError(error)) {
    return new TransportError({ message: "HTTP transport failed", retryable: false })
  }
  const request = "request" in error ? error.request : undefined
  const url = request ? redactUrl(request.url) : undefined
  if (error.reason._tag === "TransportError") {
    return new TransportError({
      message: error.reason.description ?? "HTTP transport failed",
      reason: error.reason._tag,
      url,
      retryable: false,
      request: request ? requestDetails(request) : undefined,
    })
  }
  return new TransportError({
    message: `HTTP transport failed: ${error.reason._tag}`,
    reason: error.reason._tag,
    url,
    retryable: false,
    request: request ? requestDetails(request) : undefined,
  })
}

const retryDelay = (error: ProviderRequestError) => Math.min(error.retryAfterMs ?? 500, MAX_DELAY_MS)

const retryStatusFailures = <A, R>(
  effect: Effect.Effect<A, LLMError, R>,
  retries = MAX_RETRIES,
): Effect.Effect<A, LLMError, R> =>
  Effect.catchTag(
    effect,
    "LLM.ProviderRequestError",
    (error): Effect.Effect<A, LLMError, R> => {
      if (!error.retryable || retries <= 0) return Effect.fail(error)
      return Effect.sleep(retryDelay(error)).pipe(Effect.flatMap(() => retryStatusFailures(effect, retries - 1)))
    },
  )

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const executeOnce = (request: HttpClientRequest.HttpClientRequest) =>
      http.execute(request).pipe(Effect.mapError(toHttpError), Effect.flatMap(statusError(request)))
    return Service.of({
      execute: (request) => retryStatusFailures(executeOnce(request)),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))

export * as RequestExecutor from "./executor"
