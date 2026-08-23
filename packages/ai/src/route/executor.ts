import { Cause, Context, Effect, Layer, Option, Schema, Stream } from "effect"
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import {
  HttpContext,
  HttpRateLimitDetails,
  HttpRequestDetails,
  HttpResponseDetails,
  AIError,
  TransportReason,
} from "../schema/index.js"
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

const requestId = (headers: Record<string, string>) => {
  return (
    headers["x-request-id"] ??
    headers["request-id"] ??
    headers["x-amzn-requestid"] ??
    headers["x-amz-request-id"] ??
    headers["x-goog-request-id"] ??
    headers["cf-ray"]
  )
}

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

const requestDetails = (request: HttpClientRequest.HttpClientRequest) =>
  new HttpRequestDetails({
    method: request.method,
    url: request.url,
    headers: headerDetails(request.headers),
  })

const responseDetails = (response: HttpClientResponse.HttpClientResponse) =>
  new HttpResponseDetails({
    status: response.status,
    headers: headerDetails(response.headers),
  })

const responseBody = (body: string | void) => {
  if (body === undefined) return {}
  return { body }
}

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

const responseHttp = (input: {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly body: ReturnType<typeof responseBody>
  readonly requestId?: string | undefined
  readonly rateLimit?: HttpRateLimitDetails | undefined
}) =>
  new HttpContext({
    request: requestDetails(input.request),
    response: responseDetails(input.response),
    ...input.body,
    requestId: input.requestId,
    rateLimit: input.rateLimit,
  })

const statusError =
  (request: HttpClientRequest.HttpClientRequest) => (response: HttpClientResponse.HttpClientResponse) =>
    Effect.gen(function* () {
      if (response.status < 400) return response
      const body = yield* response.text.pipe(Effect.catch(() => Effect.void))
      const headers = normalizedHeaders(response.headers)
      const retryAfter = retryAfterMs(headers)
      const rateLimit = rateLimitDetails(headers, retryAfter)
      const details = responseBody(body)
      return yield* new AIError({
        module: "RequestExecutor",
        method: "execute",
        reason: classifyProviderFailure({
          status: response.status,
          message: providerMessage(response.status, body),
          retryAfterMs: retryAfter,
          rateLimit,
          http: responseHttp({
            request,
            response,
            body: details,
            requestId: requestId(headers),
            rateLimit,
          }),
        }),
      })
    })

// Classifies an HTTP failure captured outside the executor (for example by the
// AI SDK's own fetch) onto the same reason types and HttpContext that
// executor-driven requests produce. The originating request is not available on
// that path, so the method is assumed (language model calls are always POST),
// request headers are empty.
export const classifyHttpFailure = (input: {
  readonly message: string
  readonly url: string
  readonly status?: number | undefined
  readonly code?: string | undefined
  readonly responseHeaders?: Record<string, string> | undefined
  readonly responseBody?: string | undefined
}) => {
  const headers = normalizedHeaders(Headers.fromInput(input.responseHeaders))
  const retryAfter = retryAfterMs(headers)
  const rateLimit = rateLimitDetails(headers, retryAfter)
  const details = responseBody(input.responseBody)
  return classifyProviderFailure({
    message: input.message,
    status: input.status,
    code: input.code,
    retryAfterMs: retryAfter,
    rateLimit,
    http: new HttpContext({
      request: new HttpRequestDetails({ method: "POST", url: input.url, headers: {} }),
      response:
        input.status === undefined
          ? undefined
          : new HttpResponseDetails({ status: input.status, headers: headerDetails(Headers.fromInput(headers)) }),
      ...details,
      requestId: requestId(headers),
      rateLimit,
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

const maxCauseDepth = 4

// A mid-stream rejection nests the native failure under Effect's decode wrapper,
// sometimes beyond what nativeTransportFailure can see. Walk a bounded cause
// chain and keep only stable class/code signals - never payloads - so surfaced
// errors stay diagnosable.
const describeCauseChain = (source: unknown) => {
  const classes: string[] = []
  let code: string | undefined
  let message: string | undefined
  let node: unknown = source
  for (let depth = 0; depth < maxCauseDepth && node !== null && typeof node === "object"; depth += 1) {
    const record = node as Record<string, unknown>
    if (typeof record.name === "string" && record.name !== "Error") classes.push(record.name)
    if (code === undefined && typeof record.code === "string") code = record.code
    if (
      message === undefined &&
      typeof record.message === "string" &&
      record.message.trim() !== "" &&
      !record.message.startsWith("Decode error")
    )
      message = record.message
    node = record.cause
  }
  return { classes, code, message }
}

const httpError = (input: {
  readonly error: unknown
  readonly request: HttpClientRequest.HttpClientRequest
  readonly operation: HttpOperation
}) => {
  const request = HttpClientError.isHttpClientError(input.error) ? input.error.request : input.request
  const transportError = (failure: { readonly message: string; readonly code?: string | undefined }) =>
    new AIError({
      module: "RequestExecutor",
      method: input.operation,
      reason: new TransportReason({
        message: failure.message,
        transport: "http",
        operation: input.operation,
        code: failure.code,
        url: request.url,
        http: new HttpContext({
          request: requestDetails(request),
          ...(failedResponse ? { response: responseDetails(failedResponse) } : {}),
        }),
      }),
    })

  const source =
    HttpClientError.isHttpClientError(input.error) && "cause" in input.error.reason
      ? input.error.reason.cause
      : input.error
  const native = nativeTransportFailure(source)
  // Shallow decode found no code: probe the bounded chain for the missing
  // signals instead of surfacing only Effect's generic decode message.
  const chain = native?.code === undefined ? describeCauseChain(source) : undefined
  const code = native?.code ?? chain?.code ?? chain?.classes[chain.classes.length - 1]
  const raw = native?.message ?? chain?.message ?? (input.error instanceof Error ? input.error.message : undefined)
  const detail = raw
  const message = code && detail && !detail.includes(code) ? `${code}: ${detail}` : detail

  // Read failures carry the response that broke mid-stream; keep its safe
  // metadata (status, headers) so callers can tell a truncated 200 apart.
  const failedResponse =
    input.operation === "read" &&
    HttpClientError.isHttpClientError(input.error) &&
    "response" in input.error.reason &&
    input.error.reason.response !== null &&
    typeof input.error.reason.response === "object"
      ? (input.error.reason.response as HttpClientResponse.HttpClientResponse)
      : undefined

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

export const stream = (
  executor: Interface,
  request: HttpClientRequest.HttpClientRequest,
  middleware?: HttpMiddleware,
): Stream.Stream<Uint8Array, AIError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const response = yield* executor.execute(request, middleware)
      return response.stream.pipe(
        Stream.mapError((error) => httpError({ error, request: response.request, operation: "read" })),
      )
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
            Effect.flatMap(statusError(request)),
          )

        const response = yield* middleware(request, (input) =>
          http
            .execute(input)
            .pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause))))),
        ).pipe(Effect.mapError((error) => httpError({ error, request, operation: "request" })))
        return yield* statusError(response.request)(response)
      })
    return Service.of({
      execute: executeOnce,
    })
  }),
)

export const fetchLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))

export * as RequestExecutor from "./executor.js"
