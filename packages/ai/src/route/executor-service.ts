import { Cause, Context, Effect, Option, Schema, Stream } from "effect"
import { HttpClientError, type Headers, type HttpClientRequest, type HttpClientResponse } from "effect/http"
import { AIError, HttpContext, TransportError } from "../schema/errors.js"
import type { ClientTls, RequestTimeout } from "../schema/options.js"

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

/**
 * The client certificate for the HTTP request being executed. Transports set it from `http.tls`; the executor's HTTP
 * client presents it, since only the runtime's fetch can.
 */
export const CurrentTls = Context.Reference<ClientTls | undefined>("@opencode/AI/RequestExecutor/CurrentTls", {
  defaultValue: () => undefined,
})

/**
 * Per-phase HTTP timeouts for requests executed while it is set. Transports set it from `request.timeout`;
 * `RequestExecutor` applies defaults (`DEFAULT_HTTP_TIMEOUT_MS` for headers, `DEFAULT_CHUNK_TIMEOUT_MS` between
 * response chunks) whenever a phase is left unset.
 */
export const CurrentTimeout = Context.Reference<RequestTimeout | undefined>(
  "@opencode/AI/RequestExecutor/CurrentTimeout",
  { defaultValue: () => undefined },
)
export type Service = RequestExecutorService

/**
 * Middleware for every provider request made while it is set: model calls, media submits, polls, results and cancels,
 * whatever the modality. Set it with {@link withMiddleware}. Downloads of a `url` asset don't use it; they use the
 * asset's own `middleware`, which a route sets only for URLs on the provider's origin.
 */
export const CurrentMiddleware = Context.Reference<HttpMiddleware | undefined>(
  "@opencode/AI/RequestExecutor/CurrentMiddleware",
  { defaultValue: () => undefined },
)

/** `outer` wraps `inner`: it sees the request first and the response last. */
export const composeMiddleware = (
  outer: HttpMiddleware | undefined,
  inner: HttpMiddleware | undefined,
): HttpMiddleware | undefined => {
  if (outer === undefined) return inner
  if (inner === undefined) return outer
  return (request, handler) => outer(request, (forwarded) => inner(forwarded, handler))
}

/**
 * Runs `fn` on every provider request `self` makes, an Effect or a Stream. Inside an outer `withMiddleware`, the outer
 * one wraps this one. Executor-wide middleware (`RequestExecutor.middleware`) wraps both.
 */
export const withMiddleware =
  (fn: HttpMiddleware) =>
  <Self extends Effect.Effect<unknown, unknown, unknown> | Stream.Stream<unknown, unknown, unknown>>(
    self: Self,
  ): Self => {
    const merged = Effect.gen(function* () {
      return composeMiddleware(yield* CurrentMiddleware, fn)
    })
    // One signature for both, so it infers inside `pipe`; each branch returns the same kind it was given.
    return (
      Stream.isStream(self)
        ? Stream.provideServiceEffect(self, CurrentMiddleware, merged)
        : Effect.provideServiceEffect(self, CurrentMiddleware, merged)
    ) as Self
  }

export const headerDetails = (headers: Headers.Headers) =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, value]))

export const responseHttp = (response: HttpClientResponse.HttpClientResponse) =>
  new HttpContext({
    url: response.request.url,
    status: response.status,
    headers: headerDetails(response.headers),
  })

export type HttpOperation = "request" | "read"

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

// HTTP hooks re-wrap response bodies, so a read failure can arrive as an HttpClientError caused by
// another HttpClientError. The innermost cause carries the native failure.
export const rootCause = (error: unknown): unknown =>
  HttpClientError.isHttpClientError(error) && "cause" in error.reason && error.reason.cause !== undefined
    ? rootCause(error.reason.cause)
    : error

const CONNECTION_LOST = "Connection lost while reading the response"

export const httpError = (input: {
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

  const source = rootCause(input.error)
  const native = nativeTransportFailure(source)
  const code = native?.code
  const detail =
    code && native?.message && !native.message.includes(code) ? `${code}: ${native.message}` : native?.message
  const message = detail ?? (input.error instanceof Error ? input.error.message : undefined)

  if (Cause.isTimeoutError(input.error) || Cause.isTimeoutError(source))
    return transportError({ message: message ?? "HTTP transport timed out", code: code ?? "Timeout" })
  if (!HttpClientError.isHttpClientError(input.error))
    return transportError({ message: message ?? "HTTP transport failed", code })
  // Effect reports every response body read failure as a DecodeError, but the raw byte stream decodes
  // nothing: provider output parsing happens later and fails as InvalidProviderOutput.
  if (input.operation === "read" && input.error.reason._tag === "DecodeError")
    return transportError({ message: detail ? `${CONNECTION_LOST}: ${detail}` : CONNECTION_LOST, code })
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

export const responseBytes = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<Uint8Array, AIError> =>
  response.arrayBuffer.pipe(
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.mapError((error) =>
      httpError({ error, request: response.request, operation: "read", http: responseHttp(response) }),
    ),
  )

export const responseText = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<string, AIError> =>
  response.text.pipe(
    Effect.mapError((error) =>
      httpError({ error, request: response.request, operation: "read", http: responseHttp(response) }),
    ),
  )
