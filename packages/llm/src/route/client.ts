import { Cause, Context, Effect, Layer, Schema, Stream } from "effect"
import type { Auth as AuthDef } from "./auth"
import type { Endpoint } from "./endpoint"
import { RequestExecutor } from "./executor"
import type { Framing } from "./framing"
import { HttpTransport } from "./transport"
import type { Transport, TransportRuntime } from "./transport"
import { WebSocketExecutor } from "./transport"
import type { Service as WebSocketExecutorService } from "./transport/websocket"
import type { Protocol } from "./protocol"
import * as ProviderShared from "../protocols/shared"
import * as ToolRuntime from "../tool-runtime"
import type { Tools } from "../tool"
import type { LLMError, LLMEvent, PreparedRequestOf, ProtocolID } from "../schema"
import {
  GenerationOptions,
  HttpOptions,
  LLMRequest,
  LLMResponse,
  ModelID,
  ModelLimits,
  ModelRef,
  LLMError as LLMErrorClass,
  NoRouteReason,
  PreparedRequest,
  ProviderID,
  RouteID,
  mergeGenerationOptions,
  mergeHttpOptions,
  mergeProviderOptions,
} from "../schema"

export interface RouteBody<Body> {
  /** Schema for the validated provider-native body sent as the JSON request. */
  readonly schema: Schema.Codec<Body, unknown>
  /** Build the provider-native body from a common `LLMRequest`. */
  readonly from: (request: LLMRequest) => Effect.Effect<Body, LLMError>
}

export interface Route<Body, Prepared = unknown> {
  readonly id: string
  readonly provider?: ProviderID
  readonly protocol: ProtocolID
  readonly transport: Transport<Body, Prepared, unknown>
  readonly defaults: RouteDefaults
  readonly body: RouteBody<Body>
  readonly with: (patch: RoutePatch<Body, Prepared>) => Route<Body, Prepared>
  readonly model: <Input extends RouteModelInput = RouteModelInput>(input: Input) => ModelRef
  readonly prepareTransport: (body: Body, request: LLMRequest) => Effect.Effect<Prepared, LLMError>
  readonly streamPrepared: (
    prepared: Prepared,
    request: LLMRequest,
    runtime: TransportRuntime,
  ) => Stream.Stream<LLMEvent, LLMError>
}

// Route registries intentionally erase body generics after construction.
// Normal call sites use `OpenAIChat.route`; callers only need body types
// when preparing a request with a protocol-specific type assertion.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyRoute = Route<any, any>

const routeRegistry = new Map<string, AnyRoute>()

// Route lookup is intentionally global: model refs name a route id, and
// importing the provider/protocol/custom-route module registers the runnable
// implementation. Duplicate ids are bugs because model refs cannot disambiguate
// them.
const register = <R extends AnyRoute>(route: R): R => {
  const existing = routeRegistry.get(route.id)
  if (existing && existing !== route) throw new Error(`Duplicate LLM route id "${route.id}"`)
  routeRegistry.set(route.id, route)
  return route
}

const registeredRoute = (id: string) => routeRegistry.get(id)

export type HttpOptionsInput = HttpOptions.Input

export type ModelRefInput = Omit<
  ConstructorParameters<typeof ModelRef>[0],
  "id" | "provider" | "route" | "limits" | "generation" | "http" | "auth"
> & {
  readonly id: string | ModelID
  readonly provider: string | ProviderID
  readonly route: string | RouteID
  readonly auth?: AuthDef
  readonly limits?: ModelLimits.Input
  readonly generation?: GenerationOptions.Input
  readonly http?: HttpOptionsInput
}

// `baseURL` is required on `ModelRefInput` (every materialized `ModelRef` has
// a host) but optional at the route-input layers below. The route's `defaults`
// can supply a canonical URL (e.g. OpenAI/Anthropic) so the user's input may
// omit it. Routes without a canonical URL (OpenAI-compatible, GitHub Copilot)
// re-tighten this in their own input type.
export type RouteModelInput = Omit<ModelRefInput, "provider" | "route" | "baseURL"> & {
  readonly baseURL?: string
}

export type RouteModelDefaults = Omit<ModelRefInput, "id" | "route" | "baseURL"> & {
  readonly baseURL?: string
}

export type RouteRoutedModelInput = Omit<ModelRefInput, "route" | "baseURL"> & {
  readonly baseURL?: string
}

export type RouteRoutedModelDefaults = Partial<Omit<ModelRefInput, "id" | "provider" | "route">>

export type RouteDefaults = Partial<Omit<ModelRefInput, "id" | "provider" | "route">>

export interface RoutePatch<Body, Prepared> extends RouteDefaults {
  readonly id: string
  readonly provider?: string | ProviderID
  readonly transport?: Transport<Body, Prepared, unknown>
}

type RouteMappedModelInput = RouteModelInput | RouteRoutedModelInput

export interface RouteModelOptions<
  Input extends RouteMappedModelInput,
  Output extends RouteMappedModelInput = RouteMappedModelInput,
> {
  readonly mapInput?: (input: Input) => Output
}

export interface RouteMappedModelOptions<Input, Output extends RouteMappedModelInput = RouteMappedModelInput> {
  readonly mapInput: (input: Input) => Output
}

const modelWithDefaults =
  <Input>(
    route: AnyRoute,
    defaults: Partial<Omit<ModelRefInput, "id" | "route">>,
    options: { readonly mapInput?: (input: Input) => RouteMappedModelInput },
  ) =>
  (input: Input) => {
    const mapped = options.mapInput === undefined ? (input as RouteMappedModelInput) : options.mapInput(input)
    const provider = defaults.provider ?? route.provider ?? ("provider" in mapped ? mapped.provider : undefined)
    if (!provider) throw new Error(`Route.model(${route.id}) requires a provider`)
    const baseURL = mapped.baseURL ?? defaults.baseURL ?? route.defaults.baseURL
    if (!baseURL)
      throw new Error(`Route.model(${route.id}) requires a baseURL — supply it via input, defaults, or route defaults`)
    const generation = mergeGenerationOptions(route.defaults.generation, defaults.generation)
    const providerOptions = mergeProviderOptions(route.defaults.providerOptions, defaults.providerOptions)
    const http = mergeHttpOptions(httpOptions(route.defaults.http), httpOptions(defaults.http))
    return modelRef({
      ...route.defaults,
      ...defaults,
      ...mapped,
      baseURL,
      provider,
      route: route.id,
      limits: mapped.limits ?? defaults.limits ?? route.defaults.limits,
      generation: mergeGenerationOptions(generation, mapped.generation),
      providerOptions: mergeProviderOptions(providerOptions, mapped.providerOptions),
      http: mergeHttpOptions(http, httpOptions(mapped.http)),
    })
  }

const mergeRouteDefaults = (base: RouteDefaults | undefined, patch: RouteDefaults): RouteDefaults => ({
  ...base,
  ...patch,
  limits: patch.limits ?? base?.limits,
  generation: mergeGenerationOptions(generationOptions(base?.generation), generationOptions(patch.generation)),
  providerOptions: mergeProviderOptions(base?.providerOptions, patch.providerOptions),
  http: mergeHttpOptions(httpOptions(base?.http), httpOptions(patch.http)),
})

export const modelLimits = ModelLimits.make

export const generationOptions = (input: GenerationOptions.Input | undefined) =>
  input === undefined ? undefined : GenerationOptions.make(input)

export const httpOptions = (input: HttpOptionsInput | undefined) => {
  if (input === undefined) return input
  return HttpOptions.make(input)
}

export const modelRef = (input: ModelRefInput) =>
  new ModelRef({
    ...input,
    id: ModelID.make(input.id),
    provider: ProviderID.make(input.provider),
    route: RouteID.make(input.route),
    limits: modelLimits(input.limits),
    generation: generationOptions(input.generation),
    http: httpOptions(input.http),
  })

function model<Input extends RouteModelInput = RouteModelInput>(
  route: AnyRoute,
  defaults: RouteModelDefaults,
  options?: RouteModelOptions<Input, RouteModelInput>,
): (input: Input) => ModelRef
function model<Input extends RouteRoutedModelInput = RouteRoutedModelInput>(
  route: AnyRoute,
  defaults?: RouteRoutedModelDefaults,
  options?: RouteModelOptions<Input, RouteRoutedModelInput>,
): (input: Input) => ModelRef
function model<Input, Output extends RouteMappedModelInput = RouteMappedModelInput>(
  route: AnyRoute,
  defaults: Partial<Omit<ModelRefInput, "id" | "route">>,
  options: RouteMappedModelOptions<Input, Output>,
): (input: Input) => ModelRef
function model<Input>(
  route: AnyRoute,
  defaults: Partial<Omit<ModelRefInput, "id" | "route">> = {},
  options: { readonly mapInput?: (input: Input) => RouteMappedModelInput } = {},
) {
  return modelWithDefaults(route, defaults, options)
}

export interface Interface {
  /**
   * Compile a request through protocol body construction, validation, and HTTP
   * preparation without sending it. Returns the prepared request including the
   * provider-native body.
   *
   * Pass a `Body` type argument to statically expose the route's body
   * shape (e.g. `prepare<OpenAIChatBody>(...)`) — the runtime body is
   * identical, so this is a type-level assertion the caller makes about which
   * route the request will resolve to.
   */
  readonly prepare: <Body = unknown>(request: LLMRequest) => Effect.Effect<PreparedRequestOf<Body>, LLMError>
  readonly stream: StreamMethod
  readonly generate: GenerateMethod
}

export interface StreamMethod {
  (request: LLMRequest): Stream.Stream<LLMEvent, LLMError>
  <T extends Tools>(options: ToolRuntime.RunOptions<T>): Stream.Stream<LLMEvent, LLMError>
}

export interface GenerateMethod {
  (request: LLMRequest): Effect.Effect<LLMResponse, LLMError>
  <T extends Tools>(options: ToolRuntime.RunOptions<T>): Effect.Effect<LLMResponse, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLMClient") {}

const noRoute = (model: ModelRef) =>
  new LLMErrorClass({
    module: "LLMClient",
    method: "resolveRoute",
    reason: new NoRouteReason({ route: model.route, provider: model.provider, model: model.id }),
  })

const resolveRequestOptions = (request: LLMRequest) =>
  LLMRequest.update(request, {
    generation: mergeGenerationOptions(request.model.generation, request.generation) ?? new GenerationOptions({}),
    providerOptions: mergeProviderOptions(request.model.providerOptions, request.providerOptions),
    http: mergeHttpOptions(request.model.http, request.http),
  })

export interface MakeInput<Body, Frame, Event, State> {
  /** Route id used in registry lookup and error messages. */
  readonly id: string
  /** Provider identity for route-owned model construction. */
  readonly provider?: string | ProviderID
  /** Semantic API contract — owns body construction, body schema, and parsing. */
  readonly protocol: Protocol<Body, Frame, Event, State>
  /** Where the request is sent. */
  readonly endpoint: Endpoint<Body>
  /** Per-request transport auth. Model-level `Auth` overrides this. */
  readonly auth?: AuthDef
  /** Stream framing — bytes -> frames before `protocol.stream.event` decoding. */
  readonly framing: Framing<Frame>
  /** Static / per-request headers added before `auth` runs. */
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  /** Model defaults used by the route's `.model(...)` helper. */
  readonly defaults?: RouteDefaults
}

export interface MakeTransportInput<Body, Prepared, Frame, Event, State> {
  /** Route id used in registry lookup and error messages. */
  readonly id: string
  /** Provider identity for route-owned model construction. */
  readonly provider?: string | ProviderID
  /** Semantic API contract — owns body construction, body schema, and parsing. */
  readonly protocol: Protocol<Body, Frame, Event, State>
  /** Runnable transport route. */
  readonly transport: Transport<Body, Prepared, Frame>
  /** Provider/model defaults used by the route's `.model(...)` helper. */
  readonly defaults?: RouteDefaults
}

const streamError = (route: string, message: string, cause: Cause.Cause<unknown>) => {
  const failed = cause.reasons.find(Cause.isFailReason)?.error
  if (failed instanceof LLMErrorClass) return failed
  return ProviderShared.eventError(route, message, Cause.pretty(cause))
}

function makeFromTransport<Body, Prepared, Frame, Event, State>(
  input: MakeTransportInput<Body, Prepared, Frame, Event, State>,
): Route<Body, Prepared> {
  const protocol = input.protocol
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

  const build = (routeInput: MakeTransportInput<Body, Prepared, Frame, Event, State>): Route<Body, Prepared> => {
    const route: Route<Body, Prepared> = {
      id: routeInput.id,
      provider: routeInput.provider === undefined ? undefined : ProviderID.make(routeInput.provider),
      protocol: protocol.id,
      transport: routeInput.transport,
      defaults: routeInput.defaults ?? {},
      body: protocol.body,
      with: (patch: RoutePatch<Body, Prepared>) => {
        const { id, provider, transport, ...defaults } = patch
        if (!id || id === routeInput.id) throw new Error(`Route.with(${routeInput.id}) requires a new route id`)
        return build({
          ...routeInput,
          id,
          provider: provider ?? routeInput.provider,
          transport: (transport as Transport<Body, Prepared, Frame> | undefined) ?? routeInput.transport,
          defaults: mergeRouteDefaults(routeInput.defaults, defaults),
        })
      },
      model: (input: RouteModelInput): ModelRef => modelWithDefaults<RouteModelInput>(route, {}, {})(input),
      prepareTransport: routeInput.transport.prepare,
      streamPrepared: (prepared: Prepared, request: LLMRequest, runtime: TransportRuntime) => {
        const route = `${request.model.provider}/${request.model.route}`
        const events = routeInput.transport
          .frames(prepared, request, runtime)
          .pipe(
            Stream.mapEffect(decodeEvent(route)),
            protocol.stream.terminal ? Stream.takeUntil(protocol.stream.terminal) : (stream) => stream,
          )
        return events.pipe(
          Stream.mapAccumEffect(
            protocol.stream.initial,
            protocol.stream.step,
            protocol.stream.onHalt ? { onHalt: protocol.stream.onHalt } : undefined,
          ),
          Stream.catchCause((cause) => Stream.fail(streamError(route, `Failed to read ${route} stream`, cause))),
        )
      },
    } satisfies Route<Body, Prepared>
    return register(route)
  }

  return build(input)
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
  const encodeBody = Schema.encodeSync(Schema.fromJsonString(protocol.body.schema))
  return makeFromTransport({
    id: input.id,
    provider: input.provider,
    protocol,
    transport: HttpTransport.httpJson({
      endpoint: input.endpoint,
      auth: input.auth,
      framing: input.framing,
      encodeBody,
      headers: input.headers,
    }),
    defaults: input.defaults,
  })
}

// `compile` is the important boundary: it turns a common `LLMRequest` into a
// validated provider body plus transport-private prepared data, but does not
// execute transport.
const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
  const resolved = resolveRequestOptions(request)
  const route = registeredRoute(resolved.model.route)
  if (!route) return yield* noRoute(resolved.model)

  const body = yield* route.body
    .from(resolved)
    .pipe(Effect.flatMap(ProviderShared.validateWith(Schema.decodeUnknownEffect(route.body.schema))))
  const prepared = yield* route.prepareTransport(body, resolved)

  return {
    request: resolved,
    route,
    body,
    prepared,
  }
})

const prepareWith = Effect.fn("LLMClient.prepare")(function* (request: LLMRequest) {
  const compiled = yield* compile(request)

  return new PreparedRequest({
    id: compiled.request.id ?? "request",
    route: compiled.route.id,
    protocol: compiled.route.protocol,
    model: compiled.request.model,
    body: compiled.body,
    metadata: { transport: compiled.route.transport.id },
  })
})

const streamRequestWith = (runtime: TransportRuntime) => (request: LLMRequest) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const compiled = yield* compile(request)
      return compiled.route.streamPrepared(compiled.prepared, compiled.request, runtime)
    }),
  )

const isToolRunOptions = (input: LLMRequest | ToolRuntime.RunOptions<Tools>): input is ToolRuntime.RunOptions<Tools> =>
  "request" in input && "tools" in input

const streamWith = (streamRequest: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>): StreamMethod =>
  ((input: LLMRequest | ToolRuntime.RunOptions<Tools>) => {
    if (isToolRunOptions(input)) return ToolRuntime.stream({ ...input, stream: streamRequest })
    return streamRequest(input)
  }) as StreamMethod

const generateWith = (stream: Interface["stream"]) =>
  Effect.fn("LLM.generate")(function* (input: LLMRequest | ToolRuntime.RunOptions<Tools>) {
    return new LLMResponse(
      yield* stream(input as never).pipe(
        Stream.runFold(
          () => ({ events: [] as LLMEvent[], usage: undefined as LLMResponse["usage"] }),
          (acc, event) => {
            acc.events.push(event)
            if ("usage" in event && event.usage !== undefined) acc.usage = event.usage
            return acc
          },
        ),
      ),
    )
  })

export const prepare = <Body = unknown>(request: LLMRequest) =>
  prepareWith(request) as Effect.Effect<PreparedRequestOf<Body>, LLMError>

export function stream(request: LLMRequest): Stream.Stream<LLMEvent, LLMError>
export function stream<T extends Tools>(options: ToolRuntime.RunOptions<T>): Stream.Stream<LLMEvent, LLMError>
export function stream(input: LLMRequest | ToolRuntime.RunOptions<Tools>) {
  return Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Service).stream(input as never)
    }),
  )
}

export function generate(request: LLMRequest): Effect.Effect<LLMResponse, LLMError>
export function generate<T extends Tools>(options: ToolRuntime.RunOptions<T>): Effect.Effect<LLMResponse, LLMError>
export function generate(input: LLMRequest | ToolRuntime.RunOptions<Tools>) {
  return Effect.gen(function* () {
    return yield* (yield* Service).generate(input as never)
  })
}

export const streamRequest = (request: LLMRequest) =>
  Stream.unwrap(
    Effect.gen(function* () {
      return (yield* Service).stream(request)
    }),
  )

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const stream = streamWith(streamRequestWith({ http: yield* RequestExecutor.Service }))
    return Service.of({ prepare: prepareWith as Interface["prepare"], stream, generate: generateWith(stream) })
  }),
)

export const layerWithWebSocket: Layer.Layer<Service, never, RequestExecutor.Service | WebSocketExecutorService> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const stream = streamWith(
        streamRequestWith({
          http: yield* RequestExecutor.Service,
          webSocket: yield* WebSocketExecutor.Service,
        }),
      )
      return Service.of({ prepare: prepareWith as Interface["prepare"], stream, generate: generateWith(stream) })
    }),
  )

export const Route = { make, model } as const

export const LLMClient = {
  Service,
  layer,
  layerWithWebSocket,
  prepare,
  stream,
  generate,
  stepCountIs: ToolRuntime.stepCountIs,
} as const
