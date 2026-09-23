import { Effect, Schema, Stream } from "effect"
import { Headers, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import { Auth, type AuthInput } from "./auth.js"
import { Endpoint } from "./endpoint.js"
import type { Interface } from "./executor-service.js"
import { RequestExecutor } from "./executor.js"
import { MediaProtocol } from "./media-protocol.js"
import { Generation, type Route as GenerationRoute } from "../generation.js"
import { ProviderShared } from "../protocols/shared.js"
import {
  AIError,
  AIErrorReason,
  HttpOptions,
  InvalidRequestError,
  ProviderID,
  mergeHttpOptions,
} from "../schema/index.js"
import { sanitizeSurrogates } from "../utils/sanitize.js"

export type Execute = Interface["execute"]

/** The minimum a media request must carry for the route to build a transport request. */
export interface MediaRequest {
  readonly model: { readonly id: string; readonly provider: ProviderID; readonly http?: HttpOptions }
  readonly http?: HttpOptions
}

/** Deployment inputs every media model factory accepts; provider facades fill these from `configure(...)`. */
export interface ModelInput {
  readonly id: string
  readonly auth: Auth.Definition
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** One request, one response. */
export interface Route<Request extends MediaRequest, Response> {
  readonly kind: "inline"
  readonly id: string
  readonly provider: ProviderID
  readonly protocol: string
  readonly generate: (request: Request, execute: Execute) => Effect.Effect<Response, AIError>
}

/** Submit, then poll through the returned `Generation`. */
export interface QueuedRoute<Request extends MediaRequest, Response> {
  readonly kind: "queued"
  readonly id: string
  readonly provider: ProviderID
  readonly protocol: string
  readonly start: (request: Request, execute: Execute) => Effect.Effect<Generation<Response>, AIError>
  /** Rebuild a handle from a persisted `Generation.token`; fails typed when the token is not this route's. */
  readonly resume: (
    model: MediaRequest["model"],
    token: unknown,
    execute: Execute,
  ) => Effect.Effect<Generation<Response>, AIError>
}

/** One request whose response parses into events; `generate` runs the same stream and collects it. */
export interface StreamRoute<Request extends MediaRequest, Event, Response> {
  readonly kind: "stream"
  readonly id: string
  readonly provider: ProviderID
  readonly protocol: string
  readonly stream: (request: Request, execute: Execute) => Stream.Stream<Event, AIError>
  readonly generate: (request: Request, execute: Execute) => Effect.Effect<Response, AIError>
}

export interface Composition<Request extends MediaRequest> {
  readonly id: string
  readonly provider: string | ProviderID
  readonly endpoint: Endpoint.Definition<MediaProtocol.Body, Request>
  readonly auth: Auth.Definition
  /** Deployment headers applied before transport authentication. */
  readonly headers?: Record<string, string>
}

export interface InlineInput<Request extends MediaRequest, Response> extends Composition<Request> {
  readonly protocol: MediaProtocol.Inline<Request, Response>
}

export interface QueuedInput<Request extends MediaRequest, Response, Token> extends Composition<Request> {
  readonly protocol: MediaProtocol.Queued<Request, Response, Token>
}

export interface StreamInput<Request extends MediaRequest, Event, Response, Frame, State>
  extends Composition<MediaProtocol.Addressed<Request>> {
  readonly protocol: MediaProtocol.Streamed<Request, Event, Frame, State>
  readonly collect: (events: ReadonlyArray<Event>) => Effect.Effect<Response, AIError>
}

/**
 * Compose an inline media protocol with an endpoint and auth into a runnable route. The route owns the transport
 * plumbing every media protocol would otherwise duplicate: option merging, surrogate sanitizing, unsupported-field
 * rejection, URL and query rendering, auth headers, JSON, multipart, or binary encoding, and handing responses back
 * to the protocol.
 */
export const inline = <Request extends MediaRequest, Response>(
  input: InlineInput<Request, Response>,
): Route<Request, Response> => {
  const transport = makeTransport(input)
  return {
    kind: "inline",
    id: input.id,
    provider: transport.provider,
    protocol: input.protocol.id,
    generate: Effect.fn(`MediaRoute.generate`)(function* (request: Request, execute: Execute) {
      const submitted = yield* transport.submit(
        request,
        { unsupported: input.protocol.unsupported, from: input.protocol.body.from },
        execute,
      )
      return yield* input.protocol.response.decode(submitted.response, submitted.context)
    }),
  }
}

/**
 * Compose a queued media protocol the same way, adding `start`/`resume` handles whose polls reuse the route's auth,
 * deployment headers, and (for `start`) the request's `http` overlay. The token is decoded once at the boundary and
 * closed over by the resulting `Generation.Route`.
 */
export const queued = <Request extends MediaRequest, Response, Token>(
  input: QueuedInput<Request, Response, Token>,
): QueuedRoute<Request, Response> => {
  const transport = makeTransport(input)
  const protocol = input.protocol
  const decodeToken = Schema.decodeUnknownEffect(protocol.token)
  // A protocol producing a token its own codec rejects is a programmer defect, not a provider error.
  const encodeToken = Schema.encodeSync(protocol.token)

  const generationRoute = (token: Token, http: HttpOptions | undefined, execute: Execute) => {
    const poll = <A>(operation: {
      readonly path: (token: Token) => string
      readonly decode: (
        response: HttpClientResponse.HttpClientResponse,
        context: MediaProtocol.PollContext<Token>,
      ) => Effect.Effect<A, AIError>
    }) =>
      transport
        .call("GET", operation.path(token), http, execute)
        .pipe(Effect.flatMap((sent) => operation.decode(sent.response, { token, auth: sent.auth })))
    const cancel = protocol.cancel
    const route: GenerationRoute<Response> = {
      status: poll(protocol.status),
      result: poll(protocol.result),
      cancel:
        cancel === undefined
          ? undefined
          : transport.call(cancel.method, cancel.path(token), http, execute).pipe(Effect.asVoid),
    }
    return route
  }

  const start = Effect.fn("MediaRoute.start")(function* (request: Request, execute: Execute) {
    const submitted = yield* transport.submit(
      request,
      { unsupported: protocol.unsupported, prepare: protocol.start.prepare, from: protocol.start.body.from },
      execute,
    )
    const started = yield* protocol.start.decode(submitted.response, submitted.context)
    const route = generationRoute(started.token, submitted.context.request.http, execute)
    return new Generation(route, encodeToken(started.token), started.snapshot)
  })

  const resume = Effect.fn("MediaRoute.resume")(function* (
    model: MediaRequest["model"],
    raw: unknown,
    execute: Execute,
  ) {
    const token = yield* decodeToken(raw).pipe(
      Effect.mapError(
        (cause) =>
          new AIError({
            reason: new InvalidRequestError({
              message: `${input.id} cannot resume a generation from this token`,
              cause,
            }),
          }),
      ),
    )
    const route = generationRoute(token, transport.http(model), execute)
    return new Generation(route, encodeToken(token), yield* route.status)
  })

  return { kind: "queued", id: input.id, provider: transport.provider, protocol: protocol.id, start, resume }
}

/** Compose a streaming media protocol; `generate` runs the same stream in `generate` mode and folds it with `collect`. */
export const stream = <Request extends MediaRequest, Event, Response, Frame, State>(
  input: StreamInput<Request, Event, Response, Frame, State>,
): StreamRoute<Request, Event, Response> => {
  const transport = makeTransport(input)
  const protocol = input.protocol
  const events = (request: Request, execute: Execute, mode: MediaProtocol.Mode) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const submitted = yield* transport.submit(
          { ...request, mode },
          { unsupported: protocol.unsupported, from: protocol.body.from },
          execute,
        )
        const http = RequestExecutor.responseHttp(submitted.response)
        return Stream.suspend(() => {
          // Parser state is local to one response, exactly like `Route.make`'s LLM stream loop.
          let state = protocol.initial()
          return protocol.frames(RequestExecutor.responseStream(submitted.response), submitted.context).pipe(
            Stream.mapEffect((frame) =>
              protocol.step(state, frame).pipe(
                Effect.map(([next, output]) => {
                  state = next
                  return output
                }),
              ),
            ),
            Stream.flattenIterable,
            Stream.concat(
              Stream.suspend(() => Stream.fromIterableEffect(protocol.finish(state, { ...submitted.context, http }))),
            ),
            Stream.mapError((error) =>
              error.reason.http !== undefined
                ? error
                : new AIError({
                    reason: AIErrorReason.make({
                      ...error.reason,
                      message: error.reason.message,
                      cause: error.reason.cause,
                      http,
                    }),
                  }),
            ),
          )
        })
      }),
    )
  return {
    kind: "stream",
    id: input.id,
    provider: transport.provider,
    protocol: protocol.id,
    stream: (request, execute) => events(request, execute, "stream"),
    generate: (request, execute) =>
      events(request, execute, "generate").pipe(Stream.runCollect, Effect.flatMap(input.collect)),
  }
}

// ---------------------------------------------------------------------------
// Transport plumbing shared by every kind
// ---------------------------------------------------------------------------

const makeTransport = <Request extends MediaRequest>(input: Composition<Request>) => {
  const provider = ProviderID.make(input.provider)
  const routeHttp = input.headers === undefined ? undefined : new HttpOptions({ headers: input.headers })
  const authorize = Auth.toEffect(input.auth)
  const baseURL = (path: string) => new URL(`${ProviderShared.trimBaseUrl(input.endpoint.baseURL ?? "")}${path}`)
  /** `auth` is only what `Auth` added, never deployment headers. */
  const send = Effect.fn("MediaRoute.send")(function* (
    call: {
      readonly method: AuthInput["method"]
      readonly url: URL
      readonly headers: Headers.Headers
      readonly request: AuthInput["request"]
      readonly body?: MediaProtocol.Body
    },
    execute: Execute,
  ) {
    const encoded = encode(call.body, call.headers)
    const url = call.url.toString()
    const headers = yield* authorize({
      request: call.request,
      method: call.method,
      url,
      body: encoded.text,
      headers: encoded.headers,
    })
    const response = yield* execute(
      encoded.apply(HttpClientRequest.make(call.method)(url).pipe(HttpClientRequest.setHeaders(headers))),
    )
    return { response, auth: Object.fromEntries(Object.entries(headers).filter(([key]) => !(key in call.headers))) }
  })
  return {
    provider,
    /** Route and model overlays; `start` additionally merges the request's own `http`. */
    http: (model: MediaRequest["model"]) => mergeHttpOptions(routeHttp, model.http),
    /** POST the protocol body to the route endpoint. */
    submit: Effect.fn("MediaRoute.submit")(function* (
      request: Request,
      protocol: {
        readonly unsupported?: ReadonlyArray<keyof Request & string>
        readonly prepare?: MediaProtocol.Prepare<Request>
        readonly from: (request: Request) => Effect.Effect<MediaProtocol.Body, AIError>
      },
      execute: Execute,
    ) {
      yield* rejectUnsupported(input.id, provider, request, protocol.unsupported)
      const http = mergeHttpOptions(routeHttp, request.model.http, request.http)
      const headers = Headers.fromInput(http?.headers)
      const prepared =
        protocol.prepare === undefined
          ? request
          : yield* protocol.prepare(request, (path, body) =>
              send({ method: "POST", url: baseURL(path), headers, request, body }, execute).pipe(
                Effect.map((sent) => sent.response),
              ),
            )
      // Sanitize after merging so model-level overlays are covered; the model value is restored, not sanitized.
      const resolved: Request = { ...sanitizeSurrogates({ ...prepared, http }), model: request.model }
      const body = yield* protocol.from(resolved)
      const url = withQuery(
        withQuery(
          Endpoint.render(input.endpoint, { request: resolved, body }),
          body.type === "multipart" ? undefined : body.query,
        ),
        http?.query,
      )
      const sent = yield* send({ method: "POST", url, headers, request: resolved, body }, execute)
      return { response: sent.response, context: { request: resolved, body } }
    }),
    /** Bodiless follow-up call (status, result, cancel) with the same auth and headers as `submit`. */
    call: (method: AuthInput["method"], path: string, http: HttpOptions | undefined, execute: Execute) => {
      // Provider-issued absolute URLs (fal `status_url`) are used as-is; everything else resolves against the base.
      const url = withQuery(/^https?:\/\//.test(path) ? new URL(path) : baseURL(path), http?.query)
      for (const [key, value] of Object.entries(input.endpoint.query ?? {})) url.searchParams.set(key, value)
      return send({ method, url, headers: Headers.fromInput(http?.headers), request: { http } }, execute)
    },
  }
}

const withQuery = (url: URL, query: MediaProtocol.Query | undefined) => {
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.delete(key)
    for (const item of typeof value === "string" ? [value] : value) url.searchParams.append(key, item)
  }
  return url
}

const encode = (body: MediaProtocol.Body | undefined, headers: Headers.Headers) => {
  if (body === undefined) return { text: "", headers, apply: (request: HttpClientRequest.HttpClientRequest) => request }
  if (body.type === "json") {
    const text = ProviderShared.encodeJson(body.value)
    return { text, headers, apply: HttpClientRequest.bodyText(text, "application/json") }
  }
  if (body.type === "binary")
    return {
      text: `[${body.contentType}]`,
      headers,
      apply: HttpClientRequest.bodyUint8Array(body.value, body.contentType),
    }
  return {
    text: "[multipart/form-data]",
    // The HTTP client sets the multipart boundary; a caller-supplied content-type would corrupt it.
    headers: Headers.remove(headers, "content-type"),
    apply: HttpClientRequest.bodyFormData(body.value),
  }
}

/** Common fields are never silently dropped: a present field the protocol declared unsupported fails typed. */
const rejectUnsupported = <Request extends object>(
  route: string,
  provider: ProviderID,
  request: Request,
  unsupported: ReadonlyArray<keyof Request & string> | undefined,
): Effect.Effect<void, AIError> => {
  const present = (unsupported ?? []).filter((field) => {
    const value = request[field]
    return Array.isArray(value) ? value.length > 0 : value !== undefined
  })
  if (present.length === 0) return Effect.void
  return Effect.fail(
    ProviderShared.unsupportedOperation({
      operation: `media.${present[0]}`,
      provider,
      route,
      message: `${provider}/${route} does not support ${present.join(", ")}`,
    }),
  )
}

export * as MediaRoute from "./media.js"
