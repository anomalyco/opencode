import { Cause, Context, Effect, Layer, Schema, Stream } from "effect"
import * as Option from "effect/Option"
import { Auth } from "./auth"
import { Endpoint, type EndpointPatch } from "./endpoint"
import { RequestExecutor } from "./executor"
import { Framing } from "./framing"
import { HttpTransport } from "./transport"
import type { HttpRequestTransform, Transport, TransportRuntime } from "./transport"
import { WebSocketExecutor } from "./transport"
import type { Protocol } from "./protocol"
import { applyCachePolicy } from "../cache-policy"
import * as ProviderShared from "../protocols/shared"
import type { ProtocolID, ProviderOptions } from "../schema"
import {
  AIError,
  GenerationOptions,
  HttpOptions,
  LLMRequest,
  LLMResponse,
  LanguageModel,
  LanguageModelLimits,
  LLMEvent,
  ProviderID,
  mergeGenerationOptions,
  mergeHttpOptions,
  mergeProviderOptions,
} from "../schema"

export interface RouteBody<Body> {
  /** Schema for the validated provider-native body sent as the JSON request. */
  readonly schema: Schema.Codec<Body, unknown>
  /** Build the provider-native body from a common `LLMRequest`. */
  readonly from: (request: LLMRequest) => Effect.Effect<Body, AIError>
}

export interface Route<Body, Prepared = unknown> {
  readonly id: string
  readonly provider?: ProviderID
  /** ProviderMetadata namespace emitted and consumed by this route. */
  readonly providerMetadataKey?: string
  readonly protocol: ProtocolID
  readonly endpoint: Endpoint.Definition<Body>
  readonly auth: Auth.Definition
  readonly transport: Transport<Body, Prepared, unknown>
  readonly defaults: RouteDefaults
  readonly body: RouteBody<Body>
  readonly with: (patch: RoutePatch<Body, Prepared>) => Route<Body, Prepared>
  readonly model: <Options extends ProviderOptions = ProviderOptions>(
    input: RouteMappedLanguageModelInput,
  ) => LanguageModel<Options>
  readonly prepareTransport: (
    body: Body,
    request: LLMRequest,
    options?: StreamOptions,
  ) => Effect.Effect<Prepared, AIError>
  readonly streamPrepared: (
    prepared: Prepared,
    request: LLMRequest,
    runtime: TransportRuntime,
  ) => Stream.Stream<LLMEvent, AIError>
}

// Route registries intentionally erase body generics after construction.
// Normal call sites use `OpenAIChat.route`; callers only need body types
// when preparing a request with a protocol-specific type assertion.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyRoute = Route<any, any>

export type HttpOptionsInput = HttpOptions.Input

export type RouteLanguageModelInput = Omit<LanguageModel.Input, "provider" | "route">

export type RouteRoutedLanguageModelInput = Omit<LanguageModel.Input, "route">

export interface RouteDefaults {
  readonly headers?: Record<string, string>
  readonly limits?: LanguageModelLimits
  readonly generation?: GenerationOptions
  readonly providerOptions?: ProviderOptions
  readonly http?: HttpOptions
}

export interface RouteDefaultsInput {
  readonly headers?: Record<string, string>
  readonly limits?: LanguageModelLimits.Input
  readonly generation?: GenerationOptions.Input
  readonly providerOptions?: ProviderOptions
  readonly http?: HttpOptions.Input
}

export interface RoutePatch<Body, Prepared> extends RouteDefaultsInput {
  readonly id?: string
  readonly provider?: string | ProviderID
  readonly auth?: Auth.Definition
  readonly transport?: Transport<Body, Prepared, unknown>
  readonly endpoint?: EndpointPatch<Body>
}

type RouteMappedLanguageModelInput = RouteLanguageModelInput | RouteRoutedLanguageModelInput

const makeRouteLanguageModel = <Options extends ProviderOptions = ProviderOptions>(
  route: AnyRoute,
  mapped: RouteMappedLanguageModelInput,
) => {
  const provider = route.provider ?? ("provider" in mapped ? mapped.provider : undefined)
  if (!provider) throw new Error(`Route.model(${route.id}) requires a provider`)
  if (!endpointBaseURL(route.endpoint))
    throw new Error(`Route.model(${route.id}) requires an endpoint baseURL — configure it on the route first`)
  return LanguageModel.make<Options>({
    ...mapped,
    provider,
    route,
  })
}

const mergeRouteDefaults = (base: RouteDefaults | undefined, patch: RouteDefaultsInput): RouteDefaults => {
  const headers = mergeHeaders(base?.headers, patch.headers)
  return {
    ...base,
    ...patch,
    headers,
    limits: patch.limits === undefined ? base?.limits : LanguageModelLimits.make(patch.limits),
    generation: mergeGenerationOptions(generationOptions(base?.generation), generationOptions(patch.generation)),
    providerOptions: mergeProviderOptions(base?.providerOptions, patch.providerOptions),
    http: mergeHttpOptions(
      base?.http,
      httpOptions(patch.http),
      headers === undefined ? undefined : new HttpOptions({ headers }),
    ),
  }
}

const endpointBaseURL = <Body>(endpoint: Endpoint.Definition<Body>) =>
  typeof endpoint.baseURL === "string" ? endpoint.baseURL : undefined

const mergeHeaders = (...items: ReadonlyArray<Record<string, string> | undefined>) => {
  const entries = items.flatMap((item) =>
    item === undefined ? [] : Object.entries(item).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

export const generationOptions = (input: GenerationOptions.Input | undefined) =>
  input === undefined ? undefined : GenerationOptions.make(input)

export const httpOptions = (input: HttpOptionsInput | undefined) => {
  if (input === undefined) return input
  return HttpOptions.make(input)
}

export interface Interface {
  readonly stream: StreamMethod
  readonly generate: GenerateMethod
}

export interface StreamOptions {
  readonly transform?: HttpRequestTransform
}

export interface StreamMethod {
  (request: LLMRequest, options?: StreamOptions): Stream.Stream<LLMEvent, AIError>
}

export interface GenerateMethod {
  (request: LLMRequest, options?: StreamOptions): Effect.Effect<LLMResponse, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLMClient") {}

const resolveRequestOptions = (request: LLMRequest) => {
  const routeDefaults = request.model.route.defaults
  const modelDefaults = request.model.defaults
  const generation = mergeGenerationOptions(routeDefaults.generation, modelDefaults?.generation, request.generation)
  return LLMRequest.update(request, {
    generation: generation ?? new GenerationOptions({}),
    providerOptions: mergeProviderOptions(
      routeDefaults.providerOptions,
      modelDefaults?.providerOptions,
      request.providerOptions,
    ),
    http: mergeHttpOptions(routeDefaults.http, modelDefaults?.http, request.http),
  })
}

export interface MakeInput<Body, Frame, Event, State> {
  /** Route id used in diagnostics and prepared request metadata. */
  readonly id: string
  /** Provider identity for route-owned model construction. */
  readonly provider?: string | ProviderID
  /** ProviderMetadata namespace emitted and consumed by this route. */
  readonly providerMetadataKey?: string
  /** Semantic API contract — owns body construction, body schema, and parsing. */
  readonly protocol: Protocol<Body, Frame, Event, State>
  /** Where the request is sent. */
  readonly endpoint: Endpoint.Definition<Body>
  /** Per-request transport auth. Provider facades override this via `route.with(...)`. */
  readonly auth?: Auth.Definition
  /** Stream framing — bytes -> frames before `protocol.stream.event` decoding. */
  readonly framing: Framing.Definition<Frame>
  /** Static / per-request headers added before `auth` runs. */
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  /** Route/request defaults used when compiling requests for this route. */
  readonly defaults?: RouteDefaultsInput
}

export interface MakeTransportInput<Body, Prepared, Frame, Event, State> {
  /** Route id used in diagnostics and prepared request metadata. */
  readonly id: string
  /** Provider identity for route-owned model construction. */
  readonly provider?: string | ProviderID
  /** ProviderMetadata namespace emitted and consumed by this route. */
  readonly providerMetadataKey?: string
  /** Semantic API contract — owns body construction, body schema, and parsing. */
  readonly protocol: Protocol<Body, Frame, Event, State>
  /** Where the request is sent. */
  readonly endpoint: Endpoint.Definition<Body>
  /** Per-request transport auth. Provider facades override this via `route.with(...)`. */
  readonly auth?: Auth.Definition
  /** Static / per-request headers added before `auth` runs. */
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  /** Runnable transport route. */
  readonly transport: Transport<Body, Prepared, Frame>
  /** Route/request defaults used when compiling requests for this route. */
  readonly defaults?: RouteDefaultsInput
}

const streamError = (route: string, message: string, cause: Cause.Cause<unknown>) => {
  const failed = cause.reasons.find(Cause.isFailReason)?.error
  if (failed instanceof AIError) return failed
  return ProviderShared.eventError(route, message, Cause.pretty(cause))
}

const requireTerminalEvent = (route: string) => (events: Stream.Stream<LLMEvent, AIError>) =>
  Stream.suspend(() => {
    let terminal = false
    return events.pipe(
      Stream.mapEffect((event) => {
        if (terminal)
          return Effect.fail(
            ProviderShared.eventError(route, `Provider emitted ${event.type} after the terminal event`),
          )
        if (LLMEvent.is.finish(event) || LLMEvent.is.providerError(event)) terminal = true
        return Effect.succeed(event)
      }),
      Stream.onEnd(
        Effect.suspend(() =>
          terminal
            ? Effect.void
            : Effect.fail(ProviderShared.eventError(route, "Provider stream ended without a terminal finish event")),
        ),
      ),
    )
  })

function makeFromTransport<Body, Prepared, Frame, Event, State>(
  input: MakeTransportInput<Body, Prepared, Frame, Event, State>,
): Route<Body, Prepared> {
  const protocol = input.protocol
  const encodeBody = Schema.encodeSync(Schema.fromJsonString(protocol.body.schema))
  const decodeEventEffect = Schema.decodeUnknownEffect(protocol.stream.event)
  const decodeEvent = (route: string) => (frame: Frame) =>
    decodeEventEffect(frame).pipe(
      Effect.mapError(() =>
        ProviderShared.eventError(
          input.id,
          `Invalid ${route} stream event`,
          typeof frame === "string" ? frame : ProviderShared.encodeJson(frame),
        ),
      ),
    )

  type BuiltRouteInput = Omit<MakeTransportInput<Body, Prepared, Frame, Event, State>, "defaults"> & {
    readonly defaults?: RouteDefaults
  }

  const build = (routeInput: BuiltRouteInput): Route<Body, Prepared> => {
    const route: Route<Body, Prepared> = {
      id: routeInput.id,
      provider: routeInput.provider === undefined ? undefined : ProviderID.make(routeInput.provider),
      providerMetadataKey: routeInput.providerMetadataKey,
      protocol: protocol.id,
      endpoint: routeInput.endpoint,
      auth: routeInput.auth ?? Auth.none,
      transport: routeInput.transport,
      defaults: routeInput.defaults ?? {},
      body: protocol.body,
      with: (patch: RoutePatch<Body, Prepared>) => {
        const { id, provider, auth, transport, endpoint, ...defaults } = patch
        return build({
          ...routeInput,
          id: id ?? routeInput.id,
          provider: provider ?? routeInput.provider,
          auth: auth ?? routeInput.auth,
          endpoint: endpoint ? Endpoint.merge(routeInput.endpoint, endpoint) : routeInput.endpoint,
          transport: (transport as Transport<Body, Prepared, Frame> | undefined) ?? routeInput.transport,
          defaults: mergeRouteDefaults(route.defaults, defaults),
        })
      },
      model: <Options extends ProviderOptions = ProviderOptions>(input: RouteMappedLanguageModelInput) =>
        makeRouteLanguageModel<Options>(route, input),
      prepareTransport: (body, request, options) =>
        routeInput.transport.prepare({
          body,
          request,
          endpoint: routeInput.endpoint,
          auth: routeInput.auth ?? Auth.none,
          encodeBody,
          headers: routeInput.headers,
          transform: options?.transform,
        }),
      streamPrepared: (prepared: Prepared, request: LLMRequest, runtime: TransportRuntime) => {
        const route = `${request.model.provider}/${request.model.route.id}`
        const events = routeInput.transport
          .frames(prepared, request, runtime)
          .pipe(
            Stream.mapEffect(decodeEvent(route)),
            protocol.stream.terminal ? Stream.takeUntil(protocol.stream.terminal) : (stream) => stream,
          )
        return events.pipe(
          Stream.mapAccumEffect(
            () => protocol.stream.initial(request),
            protocol.stream.step,
            protocol.stream.onHalt ? { onHalt: protocol.stream.onHalt } : undefined,
          ),
          Stream.catchCause((cause) => Stream.fail(streamError(route, `Failed to read ${route} stream`, cause))),
          requireTerminalEvent(route),
        )
      },
    } satisfies Route<Body, Prepared>
    return route
  }

  return build({ ...input, defaults: mergeRouteDefaults(undefined, input.defaults ?? {}) })
}

export function make<Body, Prepared, Frame, Event, State>(
  input: MakeTransportInput<Body, Prepared, Frame, Event, State>,
): Route<Body, Prepared>
/**
 * Build a `Route` by composing the four orthogonal pieces of a deployment:
 *
 * - `Protocol` — what is the API I'm speaking?
 * - `Endpoint` — where do I send the request?
 * - `Auth` — how do I authenticate it?
 * - `Framing` — how do I cut the response stream into protocol frames?
 *
 * Plus optional `headers` for cross-cutting deployment concerns (provider
 * version pins, per-deployment quirks).
 *
 * This is the canonical route constructor. If a new route does not fit
 * this four-axis model, add a purpose-built constructor rather than widening
 * the public surface preemptively.
 */
export function make<Body, Frame, Event, State>(
  input: MakeInput<Body, Frame, Event, State>,
): Route<Body, HttpTransport.HttpPrepared<Frame>>
export function make<Body, Prepared, Frame, Event, State>(
  input: MakeInput<Body, Frame, Event, State> | MakeTransportInput<Body, Prepared, Frame, Event, State>,
): Route<Body, Prepared> | Route<Body, HttpTransport.HttpPrepared<Frame>> {
  if ("transport" in input) return makeFromTransport(input)
  const protocol = input.protocol
  return makeFromTransport({
    id: input.id,
    provider: input.provider,
    providerMetadataKey: input.providerMetadataKey,
    protocol,
    endpoint: input.endpoint,
    auth: input.auth,
    headers: input.headers,
    transport: HttpTransport.httpJson({ framing: input.framing }),
    defaults: input.defaults,
  })
}

const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest, options?: StreamOptions) {
  const resolved = applyCachePolicy(resolveRequestOptions(request))
  const route = resolved.model.route

  const body = yield* route.body
    .from(resolved)
    .pipe(Effect.flatMap(ProviderShared.validateWith(Schema.decodeUnknownEffect(route.body.schema))))
  const prepared = yield* route.prepareTransport(body, resolved, options)

  return {
    request: resolved,
    route,
    body,
    prepared,
  }
})

/** @internal Test-only projection of the execution compiler; not exported from package barrels. */
export const compileRequest = Effect.fn("LLM.compileRequest")(function* (request: LLMRequest) {
  const compiled = yield* compile(request)
  return {
    id: compiled.request.id ?? "request",
    route: compiled.route.id,
    protocol: compiled.route.protocol,
    model: compiled.request.model,
    body: compiled.body,
    metadata: { transport: compiled.route.transport.id },
  }
})

const streamRequestWith = (runtime: TransportRuntime) => (request: LLMRequest, options?: StreamOptions) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const compiled = yield* compile(request, options)
      return compiled.route.streamPrepared(compiled.prepared, compiled.request, runtime)
    }),
  )

const generateWith = (stream: Interface["stream"]) =>
  Effect.fn("LLM.generate")(function* (request: LLMRequest, options?: StreamOptions) {
    const state = yield* stream(request, options).pipe(Stream.runFold(LLMResponse.empty, LLMResponse.reduce))
    const response = LLMResponse.complete(state)
    if (response) return response
    return yield* ProviderShared.eventError(
      `${request.model.provider}/${request.model.route.id}`,
      "Provider stream ended without a terminal finish event",
    )
  })

export function stream(request: LLMRequest, options?: StreamOptions): Stream.Stream<LLMEvent, AIError> {
  return Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Service).stream(request, options)
    }),
  ) as Stream.Stream<LLMEvent, AIError>
}

export function generate(request: LLMRequest, options?: StreamOptions): Effect.Effect<LLMResponse, AIError> {
  return Effect.gen(function* () {
    return yield* (yield* Service).generate(request, options)
  }) as Effect.Effect<LLMResponse, AIError>
}

export const streamRequest = (request: LLMRequest, options?: StreamOptions) =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Service).stream(request, options)
    }),
  )

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const stream = streamRequestWith({
      http: yield* RequestExecutor.Service,
      webSocket: Option.getOrUndefined(yield* Effect.serviceOption(WebSocketExecutor.Service)),
    })
    return Service.of({ stream, generate: generateWith(stream) })
  }),
)

export const Route = { make } as const

export const LLMClient = {
  Service,
  layer,
  stream,
  generate,
} as const
