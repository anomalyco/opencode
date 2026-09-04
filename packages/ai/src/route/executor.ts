import { Cause, Context, Effect, Layer, Option, Schema, Stream } from "effect"
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import { HttpContext, HttpRateLimitDetails, AIError, TransportError } from "../schema/index.js"
import { classifyProviderFailure } from "../provider-error.js"

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

export class Service extends Context.Service<Service, Interface>()("@opencode/AI/RequestExecutor") {}

const headerDetails = (headers: Headers.Headers) =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, String(value)]))

const normalizedHeaders = (headers: Headers.Headers) =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))

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

const addRateLimitValue = (target: Record<string, string>, key: string, value: string) => {
  if (key.length > 0) target[key] = value
}

const rateLimitDetails = (headers: Record<string, string>, retryAfter: number | undefined) => {
  const limit: Record<string, string> = {}
  const remaining: Record<string, string> = {}
  const reset: Record<string, string> = {}

  Object.entries(headers).forEach(([name, value]) => {
    const openaiLimit = /^x-ratelimit-limit-(.+)$/.exec(name)?.[1]
    if (openaiLimit) return addRateLimitValue(limit, openaiLimit, value)

    const openaiRemaining = /^x-ratelimit-remaining-(.+)$/.exec(name)?.[1]
    if (openaiRemaining) return addRateLimitValue(remaining, openaiRemaining, value)

    const openaiReset = /^x-ratelimit-reset-(.+)$/.exec(name)?.[1]
    if (openaiReset) return addRateLimitValue(reset, openaiReset, value)

    const anthropic = /^anthropic-ratelimit-(.+)-(limit|remaining|reset)$/.exec(name)
    if (!anthropic) return
    if (anthropic[2] === "limit") return addRateLimitValue(limit, anthropic[1], value)
    if (anthropic[2] === "remaining") return addRateLimitValue(remaining, anthropic[1], value)
    return addRateLimitValue(reset, anthropic[1], value)
  })

  if (
    retryAfter === undefined &&
    Object.keys(limit).length === 0 &&
    Object.keys(remaining).length === 0 &&
    Object.keys(reset).length === 0
  )
    return undefined

  return new HttpRateLimitDetails({
    retryAfterMs: retryAfter,
    limit: Object.keys(limit).length === 0 ? undefined : limit,
    remaining: Object.keys(remaining).length === 0 ? undefined : remaining,
    reset: Object.keys(reset).length === 0 ? undefined : reset,
  })
}

export const responseHttp = (response: HttpClientResponse.HttpClientResponse) =>
  new HttpContext({
    url: response.request.url,
    status: response.status,
    headers: headerDetails(response.headers),
  })

const decodeProviderBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.optionalKey(Schema.String),
      error: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
    }),
  ),
)

const providerMessage = (status: number, body: string | void) => {
  const decoded = body === undefined ? undefined : Option.getOrUndefined(decodeProviderBody(body))
  return (
    [decoded?.error?.message, decoded?.message].find((message) => message?.trim()) ??
    `Provider request failed with HTTP ${status}`
  )
}

const statusError = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    if (response.status < 400) return response
    const result = yield* response.text.pipe(Effect.result)
    return yield* httpFailure({
      message: providerMessage(response.status, result._tag === "Success" ? result.success : undefined),
      url: response.request.url,
      status: response.status,
      responseHeaders: headerDetails(response.headers),
      responseBody: result._tag === "Success" ? result.success : undefined,
      cause: result._tag === "Failure" ? (result.failure.cause ?? result.failure) : undefined,
    })
  })

/** Preserve HTTP diagnostics for executor and externally captured failures alike. */
export const httpFailure = (input: {
  readonly message: string
  readonly url?: string | undefined
  readonly status?: number | undefined
  readonly data?: unknown
  readonly responseHeaders?: Record<string, string> | undefined
  readonly responseBody?: string | undefined
  readonly cause?: unknown
}) => {
  const headers = normalizedHeaders(Headers.fromInput(input.responseHeaders))
  const retryAfter = retryAfterMs(headers)
  const rateLimit = rateLimitDetails(headers, retryAfter)
  return new AIError({
    reason: classifyProviderFailure({
      message: input.message,
      status: input.status,
      data: input.data,
      rawBody: input.responseBody,
      retryAfterMs: retryAfter,
      rateLimit,
      cause: input.cause,
      http:
        input.status === undefined || input.url === undefined
          ? undefined
          : new HttpContext({ url: input.url, status: input.status, headers }),
    }),
  })
}

type HttpOperation = "request" | "read"

const NativeTransportFailure = Schema.Struct({
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Unknown),
})
const decodeNativeTransportFailure = Schema.decodeUnknownOption(NativeTransportFailure)

const nativeTransportFailure = (error: unknown) => {
  const failure = Option.getOrUndefined(decodeNativeTransportFailure(error))
  if (!failure) return undefined
  if (failure.code !== undefined) return failure
  const cause = Option.getOrUndefined(decodeNativeTransportFailure(failure.cause))
  if (cause?.code !== undefined) return cause
  return failure
}

const httpError = (input: {
  readonly error: unknown
  readonly request: HttpClientRequest.HttpClientRequest
  readonly operation: HttpOperation
  readonly http?: HttpContext
}) => {
  const request = HttpClientError.isHttpClientError(input.error) ? input.error.request : input.request
  const transportError = (failure: { readonly message: string; readonly code?: string | undefined }) =>
    new AIError({
      reason: new TransportError({
        message: failure.message,
        cause: source,
        http: input.http,
        transport: "http",
        operation: input.operation,
        code: failure.code,
        url: request.url,
      }),
    })

  const source =
    HttpClientError.isHttpClientError(input.error) && "cause" in input.error.reason
      ? (input.error.reason.cause ?? input.error)
      : input.error
  const native = nativeTransportFailure(source)
  const code = native?.code
  const raw = native?.message ?? (input.error instanceof Error ? input.error.message : undefined)
  const detail = raw
  const message = code && detail && !detail.includes(code) ? `${code}: ${detail}` : detail

  if (Cause.isTimeoutError(input.error) || Cause.isTimeoutError(source))
    return transportError({ message: message ?? "HTTP transport timed out", code: code ?? "Timeout" })
  if (!HttpClientError.isHttpClientError(input.error))
    return transportError({ message: message ?? "HTTP transport failed", code })
  if (input.error.reason._tag === "TransportError") {
    return transportError({
      message: message ?? input.error.reason.description ?? "HTTP transport failed",
      code: code ?? input.error.reason._tag,
    })
  }
  return transportError({
    message: message ?? `HTTP transport failed: ${input.error.reason._tag}`,
    code: code ?? input.error.reason._tag,
  })
}

export const responseStream = (response: HttpClientResponse.HttpClientResponse): Stream.Stream<Uint8Array, AIError> =>
  response.stream.pipe(
    Stream.mapError((error) =>
      httpError({ error, request: response.request, operation: "read", http: responseHttp(response) }),
    ),
  )

export const stream = (
  executor: Interface,
  request: HttpClientRequest.HttpClientRequest,
  middleware?: HttpMiddleware,
): Stream.Stream<Uint8Array, AIError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const response = yield* executor.execute(request, middleware)
      return responseStream(response)
    }),
  )

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const executeOnce = (request: HttpClientRequest.HttpClientRequest, middleware?: HttpMiddleware) =>
      Effect.gen(function* () {
        if (!middleware)
          return yield* http.execute(request).pipe(
            Effect.mapError((error) => httpError({ error, request, operation: "request" })),
            Effect.flatMap(statusError),
          )

        const response = yield* middleware(request, (input) =>
          http
            .execute(input)
            .pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause))))),
        ).pipe(Effect.mapError((error) => httpError({ error, request, operation: "request" })))
        return yield* statusError(response)
      })
    return Service.of({
      execute: executeOnce,
    })
  }),
)

export const fetchLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))

export * as RequestExecutor from "./executor.js"
