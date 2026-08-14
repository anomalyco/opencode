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

const BODY_LIMIT = 16_384
const REDACTED = "<redacted>"

// One source of truth for what counts as a sensitive name across headers,
// URL query keys, and field names embedded inside request/response bodies.
//
// `SENSITIVE_NAME` is used as both a substring matcher (for free-form header
// names like `Authorization` / `X-API-Key`) and as the body-field alternation
// list. `SHORT_QUERY_NAME` covers anchored short keys like `?key=…` / `?sig=…`
// that are too generic to redact substring-style without false positives.
const SENSITIVE_NAME_SOURCE =
  "authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|credential|signature|x-amz-signature"
const SENSITIVE_NAME = new RegExp(SENSITIVE_NAME_SOURCE, "i")
const SHORT_QUERY_NAME = /^(key|sig)$/i
const SENSITIVE_BODY_FIELD = new RegExp(`(?:${SENSITIVE_NAME_SOURCE}|key)`, "i")
const REDACT_JSON_FIELD = new RegExp(`("(?:${SENSITIVE_BODY_FIELD.source})"\\s*:\\s*)"[^"]*"`, "gi")
const REDACT_QUERY_FIELD = new RegExp(`((?:${SENSITIVE_BODY_FIELD.source})=)[^&\\s"]+`, "gi")

const isSensitiveHeaderName = (name: string) => SENSITIVE_NAME.test(name)

const isSensitiveQueryName = (name: string) => isSensitiveHeaderName(name) || SHORT_QUERY_NAME.test(name)

const redactHeaders = (headers: Headers.Headers, redactedNames: ReadonlyArray<string | RegExp>) =>
  Object.fromEntries(
    Object.entries(Headers.redact(headers, [...redactedNames, SENSITIVE_NAME])).map(([name, value]) => [
      name,
      String(value),
    ]),
  )

const redactUrl = (value: string) => {
  if (!URL.canParse(value)) return REDACTED
  const url = new URL(value)
  url.searchParams.forEach((_, key) => {
    if (isSensitiveQueryName(key)) url.searchParams.set(key, REDACTED)
  })
  return url.toString()
}

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

const requestDetails = (request: HttpClientRequest.HttpClientRequest, redactedNames: ReadonlyArray<string | RegExp>) =>
  new HttpRequestDetails({
    method: request.method,
    url: redactUrl(request.url),
    headers: redactHeaders(request.headers, redactedNames),
  })

const responseDetails = (
  response: HttpClientResponse.HttpClientResponse,
  redactedNames: ReadonlyArray<string | RegExp>,
) =>
  new HttpResponseDetails({
    status: response.status,
    headers: redactHeaders(response.headers, redactedNames),
  })

const secretValues = (request: HttpClientRequest.HttpClientRequest) => {
  const values = new Set<string>()
  const add = (value: string) => {
    if (value.length < 4) return
    values.add(value)
    values.add(encodeURIComponent(value))
  }

  Object.entries(request.headers).forEach(([name, value]) => {
    if (!isSensitiveHeaderName(name)) return
    add(value)
    const bearer = /^Bearer\s+(.+)$/i.exec(value)?.[1]
    if (bearer) add(bearer)
  })

  if (!URL.canParse(request.url)) return values
  new URL(request.url).searchParams.forEach((value, key) => {
    if (isSensitiveQueryName(key)) add(value)
  })
  return values
}

// Two passes: structural (redact `"name": "value"` and `name=value` patterns
// for any field name that looks sensitive) plus literal (replace any actual
// secret values we sent in the request, in case the response echoes one back).
const redactBody = (body: string, secrets: ReadonlySet<string>) =>
  Array.from(secrets).reduce(
    (text, secret) => text.split(secret).join(REDACTED),
    body.replace(REDACT_JSON_FIELD, `$1"${REDACTED}"`).replace(REDACT_QUERY_FIELD, `$1${REDACTED}`),
  )

const responseBody = (body: string | void, secrets: ReadonlySet<string>) => {
  if (body === undefined) return {}
  const redacted = redactBody(body, secrets)
  if (redacted.length <= BODY_LIMIT) return { body: redacted }
  return { body: redacted.slice(0, BODY_LIMIT), bodyTruncated: true }
}

const decodeProviderBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.optionalKey(Schema.String),
      error: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
    }),
  ),
)

const providerMessage = (status: number, body: { readonly body?: string }) => {
  if (body.body && body.body.length <= 500) {
    const decoded = Option.getOrUndefined(decodeProviderBody(body.body))
    return `Provider request failed with HTTP ${status}: ${decoded?.error?.message ?? decoded?.message ?? body.body}`
  }
  return `Provider request failed with HTTP ${status}`
}

const responseHttp = (input: {
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly redactedNames: ReadonlyArray<string | RegExp>
  readonly body: ReturnType<typeof responseBody>
  readonly requestId?: string | undefined
  readonly rateLimit?: HttpRateLimitDetails | undefined
}) =>
  new HttpContext({
    request: requestDetails(input.request, input.redactedNames),
    response: responseDetails(input.response, input.redactedNames),
    ...input.body,
    requestId: input.requestId,
    rateLimit: input.rateLimit,
  })

const statusError =
  (request: HttpClientRequest.HttpClientRequest, redactedNames: ReadonlyArray<string | RegExp>) =>
  (response: HttpClientResponse.HttpClientResponse) =>
    Effect.gen(function* () {
      if (response.status < 400) return response
      const body = yield* response.text.pipe(Effect.catch(() => Effect.void))
      const headers = normalizedHeaders(response.headers)
      const retryAfter = retryAfterMs(headers)
      const rateLimit = rateLimitDetails(headers, retryAfter)
      const details = responseBody(body, secretValues(request))
      return yield* new AIError({
        module: "RequestExecutor",
        method: "execute",
        reason: classifyProviderFailure({
          status: response.status,
          message: providerMessage(response.status, details),
          retryAfterMs: retryAfter,
          rateLimit,
          http: responseHttp({
            request,
            response,
            redactedNames,
            body: details,
            requestId: requestId(headers),
            rateLimit,
          }),
        }),
      })
    })

// Classifies an HTTP failure captured outside the executor (for example by the
// AI SDK's own fetch) onto the same reason types and redacted HttpContext that
// executor-driven requests produce. The originating request is not available on
// that path, so the method is assumed (language model calls are always POST),
// request headers are empty, and only structural body redaction applies.
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
  const details = responseBody(input.responseBody ?? undefined, new Set<string>())
  return classifyProviderFailure({
    message: input.message,
    status: input.status,
    code: input.code,
    retryAfterMs: retryAfter,
    rateLimit,
    http: new HttpContext({
      request: new HttpRequestDetails({ method: "POST", url: redactUrl(input.url), headers: {} }),
      response:
        input.status === undefined
          ? undefined
          : new HttpResponseDetails({ status: input.status, headers: redactHeaders(Headers.fromInput(headers), []) }),
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

const httpError = (input: {
  readonly error: unknown
  readonly request: HttpClientRequest.HttpClientRequest
  readonly operation: HttpOperation
  readonly redactedNames: ReadonlyArray<string | RegExp>
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
        url: redactUrl(request.url),
        http: new HttpContext({ request: requestDetails(request, input.redactedNames) }),
      }),
    })

  const source =
    HttpClientError.isHttpClientError(input.error) && "cause" in input.error.reason
      ? input.error.reason.cause
      : input.error
  const native = nativeTransportFailure(source)
  const code = native?.code
  const raw = native?.message ?? (input.error instanceof Error ? input.error.message : undefined)
  const detail = raw ? redactBody(raw, secretValues(request)) : undefined
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

export const stream = (
  executor: Interface,
  request: HttpClientRequest.HttpClientRequest,
  middleware?: HttpMiddleware,
): Stream.Stream<Uint8Array, AIError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const redactedNames = yield* Headers.CurrentRedactedNames
      const response = yield* executor.execute(request, middleware)
      return response.stream.pipe(
        Stream.mapError((error) => httpError({ error, request: response.request, operation: "read", redactedNames })),
      )
    }),
  )

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const executeOnce = (request: HttpClientRequest.HttpClientRequest, middleware?: HttpMiddleware) =>
      Effect.gen(function* () {
        const redactedNames = yield* Headers.CurrentRedactedNames
        if (!middleware)
          return yield* http.execute(request).pipe(
            Effect.mapError((error) => httpError({ error, request, operation: "request", redactedNames })),
            Effect.flatMap(statusError(request, redactedNames)),
          )

        const response = yield* middleware(request, (input) =>
          http
            .execute(input)
            .pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause))))),
        ).pipe(Effect.mapError((error) => httpError({ error, request, operation: "request", redactedNames })))
        return yield* statusError(response.request, redactedNames)(response)
      })
    return Service.of({
      execute: executeOnce,
    })
  }),
)

export const fetchLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))

export * as RequestExecutor from "./executor.js"
