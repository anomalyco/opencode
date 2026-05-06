import { Cause, Context, Effect, Layer, Random } from "effect"
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
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 10_000
const REDACTED = "<redacted>"

const sensitiveHeaderName = (name: string) =>
  /authorization|api[-_]?key|token|secret|credential|signature|x-amz-signature/i.test(name)

const sensitiveQueryName = (name: string) => sensitiveHeaderName(name) || /^(key|sig)$/i.test(name)

const redactHeaders = (headers: Headers.Headers) =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      sensitiveHeaderName(name) ? REDACTED : value,
    ]),
  )

const redactUrl = (value: string) => {
  if (!URL.canParse(value)) return REDACTED
  const url = new URL(value)
  url.searchParams.forEach((_, key) => {
    if (sensitiveQueryName(key)) url.searchParams.set(key, REDACTED)
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

const redactBody = (body: string) =>
  body
    .replace(
      /("(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|authorization|credential|signature|key)"\s*:\s*)"[^"]*"/gi,
      `$1"${REDACTED}"`,
    )
    .replace(
      /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|signature|key)=)[^&\s"]+/gi,
      `$1${REDACTED}`,
    )

const responseBody = (body: string | void) => {
  if (body === undefined) return {}
  const redacted = redactBody(body)
  if (redacted.length <= BODY_LIMIT) return { body: redacted }
  return { body: redacted.slice(0, BODY_LIMIT), bodyTruncated: true }
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

const retryDelay = (error: ProviderRequestError, attempt: number) => {
  if (error.retryAfterMs !== undefined) return Effect.succeed(Math.min(error.retryAfterMs, MAX_DELAY_MS))
  return Random.nextBetween(
    Math.min(BASE_DELAY_MS * 2 ** attempt * 0.8, MAX_DELAY_MS),
    Math.min(BASE_DELAY_MS * 2 ** attempt * 1.2, MAX_DELAY_MS),
  ).pipe(Effect.map((delay) => Math.round(delay)))
}

const retryStatusFailures = <A, R>(
  effect: Effect.Effect<A, LLMError, R>,
  retries = MAX_RETRIES,
  attempt = 0,
): Effect.Effect<A, LLMError, R> =>
  Effect.catchTag(
    effect,
    "LLM.ProviderRequestError",
    (error): Effect.Effect<A, LLMError, R> => {
      if (!error.retryable || retries <= 0) return Effect.fail(error)
      return retryDelay(error, attempt).pipe(
        Effect.flatMap((delay) => Effect.sleep(delay)),
        Effect.flatMap(() => retryStatusFailures(effect, retries - 1, attempt + 1)),
      )
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
