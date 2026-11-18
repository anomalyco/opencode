import { Cause, Clock, Duration, Effect, Inspectable, Layer, Pipeable, Schema, Stream } from "effect"
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpIncomingMessage,
  UrlParams,
} from "effect/http"
import {
  AIError,
  DEFAULT_CHUNK_TIMEOUT_MS,
  DEFAULT_HTTP_TIMEOUT_MS,
  HttpContext,
  HttpRateLimitDetails,
  timeoutConfig,
  TransportError,
  type ClientTls,
  type HttpTimeout,
  type RequestTimeout,
} from "../schema/index.js"
import { classifyProviderFailure, providerErrorMessage } from "../provider-error.js"
import { concatBytes } from "../utils/bytes.js"
import {
  composeMiddleware,
  CurrentMiddleware,
  CurrentTimeout,
  CurrentTls,
  headerDetails,
  httpError,
  responseStream,
  Service,
  type HttpMiddleware,
  type HttpOperation,
  type Interface,
} from "./executor-service.js"

export {
  composeMiddleware,
  CurrentMiddleware,
  CurrentTimeout,
  CurrentTls,
  responseBytes,
  responseHttp,
  responseStream,
  responseText,
  Service,
  withMiddleware,
} from "./executor-service.js"
export type { HttpHandler, HttpMiddleware, Interface, RequestExecutorService } from "./executor-service.js"

const normalizedHeaders = (headers: Headers.Headers) =>
  Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))

const clampRetryAfterMs = (millis: number) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.ceil(millis)))

const retryAfterMs = (headers: Record<string, string>) => {
  const millis = Number(headers["retry-after-ms"])
  if (Number.isFinite(millis)) return clampRetryAfterMs(millis)

  const value = headers["retry-after"]
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return clampRetryAfterMs(seconds * 1000)

  const date = Date.parse(value)
  if (!Number.isNaN(date)) return clampRetryAfterMs(date - Date.now())
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

const MAX_BODY_CHARS = 2000

// Without a recognized message, show the raw body so the provider's explanation is never dropped.
const providerMessage = (status: number, body: string | void) => {
  const fallback = `Provider request failed with HTTP ${status}`
  const text = body?.trim() ?? ""
  const message = providerErrorMessage(text)
  if (message) return message
  // Gateway and proxy HTML error pages are markup, not an explanation.
  if (!text || /^<(?:!doctype|html)/i.test(text)) return fallback
  return `${fallback}: ${text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text}`
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

const timeoutDuration = (value: HttpTimeout | undefined, fallback = DEFAULT_HTTP_TIMEOUT_MS) =>
  value === false ? Duration.infinity : Duration.millis(value ?? fallback)

const timeoutError = (url: string, operation: HttpOperation, message: string, http?: HttpContext) =>
  new AIError({
    reason: new TransportError({
      message,
      transport: "http",
      operation,
      code: "Timeout",
      url,
      http,
    }),
  })

const bodyTimeoutError = (response: HttpClientResponse.HttpClientResponse, message: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.DecodeError({
      request: response.request,
      response,
      cause: new Cause.TimeoutError(message),
    }),
  })

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer
    : bytes.slice().buffer

const decodeJsonBody = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))

// Bounds every body accessor on the response (`stream`, `text`, `arrayBuffer`, `json`, `urlParamsBody`, `formData`)
// with the chunk and whole-request limits so stalled bodies fail cleanly regardless of how a caller reads them.
const withBodyTimeouts = (
  raw: HttpClientResponse.HttpClientResponse,
  limits: { readonly chunk: Duration.Duration; readonly deadline: number | undefined },
): Effect.Effect<HttpClientResponse.HttpClientResponse> => {
  if (!Duration.isFinite(limits.chunk) && limits.deadline === undefined) return Effect.succeed(raw)
  return Effect.gen(function* () {
    const chunked = Duration.isFinite(limits.chunk)
      ? raw.stream.pipe(
          Stream.timeoutOrElse({
            duration: limits.chunk,
            orElse: () => Stream.fail(bodyTimeoutError(raw, "Timed out waiting for response data")),
          }),
        )
      : raw.stream
    const timedStream =
      limits.deadline === undefined
        ? chunked
        : Stream.unwrap(
            Effect.gen(function* () {
              const left = limits.deadline! - (yield* Clock.currentTimeMillis)
              if (left <= 0) return Stream.fail(bodyTimeoutError(raw, "Timed out waiting for the response to complete"))
              return chunked.pipe(
                Stream.interruptWhen(
                  Effect.sleep(Duration.millis(left)).pipe(
                    Effect.andThen(
                      Effect.fail(bodyTimeoutError(raw, "Timed out waiting for the response to complete")),
                    ),
                  ),
                ),
              )
            }),
          )
    const bytes = yield* Effect.cached(
      Stream.runCollect(timedStream).pipe(
        Effect.map((chunks) => concatBytes(chunks)),
        Effect.catchIf(
          (error) => error.reason._tag === "EmptyBodyError",
          () => Effect.succeed(new Uint8Array(0)),
        ),
      ),
    )
    const text = Effect.map(bytes, (data) => new TextDecoder().decode(data))
    const arrayBuffer = Effect.map(bytes, toArrayBuffer)
    const json = Effect.flatMap(text, (body) =>
      body === ""
        ? Effect.succeed<Schema.Json>(null)
        : decodeJsonBody(body).pipe(
            Effect.mapError(
              (cause) =>
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.DecodeError({ request: raw.request, response: raw, cause }),
                }),
            ),
          ),
    )
    const urlParamsBody = Effect.flatMap(text, (body) =>
      Effect.try({
        try: () => UrlParams.fromInput(new URLSearchParams(body)),
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.DecodeError({ request: raw.request, response: raw, cause }),
          }),
      }),
    )
    const formData = Effect.gen(function* () {
      const left =
        limits.deadline === undefined
          ? Duration.infinity
          : Duration.millis(Math.max(0, limits.deadline - (yield* Clock.currentTimeMillis)))
      const limit = Duration.min(limits.chunk, left)
      if (!Duration.isFinite(limit)) return yield* raw.formData
      return yield* raw.formData.pipe(
        Effect.timeoutOrElse({
          duration: limit,
          orElse: () => Effect.fail(bodyTimeoutError(raw, "Timed out waiting for response data")),
        }),
      )
    })
    const wrapped: HttpClientResponse.HttpClientResponse = {
      [HttpIncomingMessage.TypeId]: HttpIncomingMessage.TypeId,
      [HttpClientResponse.TypeId]: HttpClientResponse.TypeId,
      request: raw.request,
      get url() {
        return raw.url
      },
      status: raw.status,
      get headers() {
        return raw.headers
      },
      get cookies() {
        return raw.cookies
      },
      get remoteAddress() {
        return raw.remoteAddress
      },
      get upgrade() {
        return raw.upgrade
      },
      stream: timedStream,
      text,
      arrayBuffer,
      json,
      urlParamsBody,
      formData,
      toJSON: () => raw.toJSON(),
      toString: () => raw.toString(),
      [Inspectable.NodeInspectSymbol]: () => raw[Inspectable.NodeInspectSymbol](),
      pipe() {
        return Pipeable.pipeArguments(wrapped, arguments)
      },
    }
    return wrapped
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
      return responseStream(response)
    }),
  )

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const executeOnce = (
      request: HttpClientRequest.HttpClientRequest,
      middleware: HttpMiddleware | undefined,
      timeout: RequestTimeout | undefined,
    ) =>
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis
        const limits = timeoutConfig(timeout)
        // Unlike the header and chunk limits, the whole-request budget has no default.
        const total = limits.total ? Duration.millis(limits.total) : Duration.infinity
        const headersLimit = Duration.min(timeoutDuration(limits.headers), total)
        const send = !middleware
          ? http.execute(request).pipe(Effect.mapError((error) => httpError({ error, request, operation: "request" })))
          : middleware(request, (input) =>
              http
                .execute(input)
                .pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause))))),
            ).pipe(Effect.mapError((error) => httpError({ error, request, operation: "request" })))
        const raw = yield* send.pipe(
          Effect.timeoutOrElse({
            duration: headersLimit,
            orElse: () => Effect.fail(timeoutError(request.url, "request", "Timed out waiting for response headers")),
          }),
        )
        const deadline = Duration.isFinite(total) ? started + Duration.toMillis(total) : undefined
        const response = yield* withBodyTimeouts(raw, {
          chunk: timeoutDuration(limits.chunk, DEFAULT_CHUNK_TIMEOUT_MS),
          deadline,
        })
        return yield* statusError(response)
      })
    return Service.of({
      // Scoped middleware and timeouts are cleared while the request runs, so a request a middleware makes itself
      // isn't wrapped again and starts with default timeouts.
      execute: (request, next) =>
        Effect.gen(function* () {
          const middleware = composeMiddleware(yield* CurrentMiddleware, next)
          const timeout = yield* CurrentTimeout
          return yield* executeOnce(request, middleware, timeout).pipe(
            Effect.provideService(CurrentMiddleware, undefined),
            Effect.provideService(CurrentTimeout, undefined),
          )
        }),
    })
  }),
)

export const fetchLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))

/**
 * Sends through `execute`, presenting `tls` on each request. Apply it only where a provider request is sent, so
 * downloads made through the plain executor never carry the certificate. The executor's HTTP client reads `CurrentTls`.
 */
export const withTls = (execute: Interface["execute"], tls: ClientTls | undefined): Interface["execute"] =>
  tls ? (request, middleware) => execute(request, middleware).pipe(Effect.provideService(CurrentTls, tls)) : execute

/** Sends through `execute` with `timeout` applied to the request and its response body. */
export const withTimeout = (
  execute: Interface["execute"],
  timeout: RequestTimeout | undefined,
): Interface["execute"] =>
  timeout === undefined
    ? execute
    : (request, middleware) => execute(request, middleware).pipe(Effect.provideService(CurrentTimeout, timeout))

/**
 * Per-call middleware that sends through `fetch` instead of the executor's HTTP client. Executor middleware and
 * `middleware` still wrap the call, and status classification still applies.
 */
export const withFetch = (
  fetch: typeof globalThis.fetch | undefined,
  middleware?: HttpMiddleware,
): HttpMiddleware | undefined => {
  if (fetch === undefined) return middleware
  const send = (request: HttpClientRequest.HttpClientRequest) =>
    HttpClient.execute(request).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    )
  return middleware === undefined ? send : (request) => middleware(request, send)
}

/**
 * Run `fn` on every request: it sees the raw response before status classification, inside middleware already on
 * `executor`, and outside per-call and scoped ({@link withMiddleware}) middleware.
 */
export const middleware = (fn: HttpMiddleware, executor: Layer.Layer<Service> = fetchLayer): Layer.Layer<Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const inner = yield* Service
      return Service.of({
        // Scoped middleware sits where per-call middleware does, inside `fn`; it is read here and cleared so the
        // executors below don't apply it again.
        execute: (request, next) =>
          Effect.gen(function* () {
            const scoped = composeMiddleware(yield* CurrentMiddleware, next)
            return yield* inner
              .execute(request, composeMiddleware(fn, scoped))
              .pipe(Effect.provideService(CurrentMiddleware, undefined))
          }),
      })
    }),
  ).pipe(Layer.provide(executor))

export * as RequestExecutor from "./executor.js"
