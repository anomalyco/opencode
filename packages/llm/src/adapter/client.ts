import { Cause, Context, Effect, Layer, Schema, Stream } from "effect"
import type { Auth as AuthDef } from "./auth"
import type { Endpoint } from "./endpoint"
import { RequestExecutor } from "./executor"
import type { Framing } from "./framing"
import { HttpTransport } from "./transport"
import type { Transport, TransportRuntime } from "./transport"
import { WebSocketExecutor } from "./transport"
import type { Protocol } from "./protocol"
import * as ProviderShared from "../protocols/shared"
import * as ToolRuntime from "../tool-runtime"
import type { Tools } from "../tool"
import type {
  AdapterID,
  LLMError,
  LLMEvent,
  PreparedRequestOf,
  ProtocolID,
} from "../schema"
import {
  GenerationOptions,
  HttpOptions,
  LLMRequest,
  LLMResponse,
  ModelCapabilities,
  ModelID,
  ModelLimits,
  ModelRef,
  LLMError as LLMErrorClass,
  NoAdapterReason,
  PreparedRequest,
  ProviderID,
  mergeGenerationOptions,
  mergeHttpOptions,
  mergeProviderOptions,
} from "../schema"

export interface AdapterContext {
  readonly request: LLMRequest
}

export interface Adapter<Payload, Prepared = unknown> {
  readonly id: string
  readonly protocol: ProtocolID
  readonly transport: string
  readonly payloadSchema: Schema.Codec<Payload, unknown>
  readonly toPayload: (request: LLMRequest) => Effect.Effect<Payload, LLMError>
  readonly prepareTransport: (
    payload: Payload,
    context: AdapterContext,
  ) => Effect.Effect<Prepared, LLMError>
  readonly streamPrepared: (
    prepared: Prepared,
    context: AdapterContext,
    runtime: TransportRuntime,
  ) => Stream.Stream<LLMEvent, LLMError>
}

// Adapter registries intentionally erase payload generics after construction.
// Normal call sites use `OpenAIChat.adapter`; callers only need payload types
// when preparing a request with a protocol-specific type assertion.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyAdapter = Adapter<any, any>

const adapterRegistry = new Map<string, AnyAdapter>()

// The first adapter registered for an id is the package default. Adapter lookup
// is intentionally global: model refs name an adapter id, and importing the
// provider/protocol/custom-adapter module registers the runnable implementation.
const register = <Adapter extends AnyAdapter>(adapter: Adapter): Adapter => {
  if (!adapterRegistry.has(adapter.id)) adapterRegistry.set(adapter.id, adapter)
  return adapter
}

const registeredAdapter = (id: string) => adapterRegistry.get(id)

export type ModelCapabilitiesInput = Exclude<ModelCapabilities.Input, ModelCapabilities>

export type HttpOptionsInput = HttpOptions.Input

export type ModelRefInput = Omit<
  ConstructorParameters<typeof ModelRef>[0],
  "id" | "provider" | "adapter" | "capabilities" | "limits" | "generation" | "http" | "auth"
> & {
  readonly id: string | ModelID
  readonly provider: string | ProviderID
  readonly adapter?: string | AdapterID
  readonly auth?: AuthDef
  readonly capabilities?: ModelCapabilities.Input
  readonly limits?: ModelLimits.Input
  readonly generation?: GenerationOptions.Input
  readonly http?: HttpOptionsInput
}

export type AdapterModelInput = Omit<ModelRefInput, "provider" | "adapter" | "protocol">

export type AdapterModelDefaults = Omit<ModelRefInput, "id" | "adapter" | "protocol">

export type AdapterRoutedModelInput = Omit<ModelRefInput, "adapter" | "protocol">

export type AdapterRoutedModelDefaults = Partial<Omit<ModelRefInput, "id" | "provider" | "adapter" | "protocol">>

type AdapterMappedModelInput = AdapterModelInput | AdapterRoutedModelInput

export interface AdapterModelOptions<Input extends AdapterMappedModelInput, Output extends AdapterMappedModelInput = AdapterMappedModelInput> {
  readonly mapInput?: (input: Input) => Output
}

export interface AdapterMappedModelOptions<Input, Output extends AdapterMappedModelInput = AdapterMappedModelInput> {
  readonly mapInput: (input: Input) => Output
}

export const modelCapabilities = ModelCapabilities.make

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
    adapter: input.adapter ?? input.protocol,
    protocol: input.protocol,
    capabilities: modelCapabilities(input.capabilities),
    limits: modelLimits(input.limits),
    generation: generationOptions(input.generation),
    http: httpOptions(input.http),
  })

function model<Input extends AdapterModelInput = AdapterModelInput>(
  adapter: AnyAdapter,
  defaults: AdapterModelDefaults,
  options?: AdapterModelOptions<Input, AdapterModelInput>,
): (input: Input) => ModelRef
function model<Input extends AdapterRoutedModelInput = AdapterRoutedModelInput>(
  adapter: AnyAdapter,
  defaults?: AdapterRoutedModelDefaults,
  options?: AdapterModelOptions<Input, AdapterRoutedModelInput>,
): (input: Input) => ModelRef
function model<Input, Output extends AdapterMappedModelInput = AdapterMappedModelInput>(
  adapter: AnyAdapter,
  defaults: Partial<Omit<ModelRefInput, "id" | "adapter" | "protocol">>,
  options: AdapterMappedModelOptions<Input, Output>,
): (input: Input) => ModelRef
function model<Input>(
  adapter: AnyAdapter,
  defaults: Partial<Omit<ModelRefInput, "id" | "adapter" | "protocol">> = {},
  options: { readonly mapInput?: (input: Input) => AdapterMappedModelInput } = {},
) {
  return (input: Input) => {
    const mapped = options.mapInput === undefined ? input as AdapterMappedModelInput : options.mapInput(input)
    const provider = defaults.provider ?? ("provider" in mapped ? mapped.provider : undefined)
    if (!provider) throw new Error(`Adapter.model(${adapter.id}) requires a provider`)
    register(adapter)
    return modelRef({
      ...defaults,
      ...mapped,
      provider,
      adapter: adapter.id,
      protocol: adapter.protocol,
      capabilities: mapped.capabilities ?? defaults.capabilities,
      limits: mapped.limits ?? defaults.limits,
      generation: mergeGenerationOptions(defaults.generation, mapped.generation),
      providerOptions: mergeProviderOptions(defaults.providerOptions, mapped.providerOptions),
      http: mergeHttpOptions(httpOptions(defaults.http), httpOptions(mapped.http)),
    })
  }
}

export interface Interface {
  /**
   * Compile a request through protocol payload lowering, validation, and HTTP
   * construction without sending it. Returns the prepared request including the
   * provider-native payload.
   *
   * Pass a `Payload` type argument to statically expose the adapter's payload
    * shape (e.g. `prepare<OpenAIChatPayload>(...)`) — the runtime payload is
   * identical, so this is a type-level assertion the caller makes about which
   * adapter the request will resolve to.
   */
  readonly prepare: <Payload = unknown>(request: LLMRequest) => Effect.Effect<PreparedRequestOf<Payload>, LLMError>
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

const noAdapter = (model: ModelRef) =>
  new LLMErrorClass({
    module: "LLMClient",
    method: "resolveAdapter",
    reason: new NoAdapterReason({ adapter: model.adapter, protocol: model.protocol, provider: model.provider, model: model.id }),
  })

const resolveRequestOptions = (request: LLMRequest) =>
  LLMRequest.update(request, {
    generation: mergeGenerationOptions(request.model.generation, request.generation) ?? new GenerationOptions({}),
    providerOptions: mergeProviderOptions(request.model.providerOptions, request.providerOptions),
    http: mergeHttpOptions(request.model.http, request.http),
  })

export interface MakeInput<Payload, Frame, Chunk, State> {
  /** Adapter id used in registry lookup and error messages. */
  readonly id: string
  /** Semantic API contract — owns lowering, payload schema, and parsing. */
  readonly protocol: Protocol<Payload, Frame, Chunk, State>
  /** Where the request is sent. */
  readonly endpoint: Endpoint<Payload>
  /** Per-request transport auth. Model-level `Auth` overrides this. */
  readonly auth?: AuthDef
  /** Stream framing — bytes -> frames before `protocol.chunk` decoding. */
  readonly framing: Framing<Frame>
  /** Static / per-request headers added before `auth` runs. */
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
}

export interface MakeTransportInput<Payload, Prepared, Frame, Chunk, State> {
  /** Adapter id used in registry lookup and error messages. */
  readonly id: string
  /** Semantic API contract — owns lowering, payload schema, and parsing. */
  readonly protocol: Protocol<Payload, Frame, Chunk, State>
  /** Runnable transport route. */
  readonly transport: Transport<Payload, Prepared, Frame>
}

const streamError = (adapter: string, message: string, cause: Cause.Cause<unknown>) => {
  const failed = cause.reasons.find(Cause.isFailReason)?.error
  if (failed instanceof LLMErrorClass) return failed
  return ProviderShared.chunkError(adapter, message, Cause.pretty(cause))
}

function makeFromTransport<Payload, Prepared, Frame, Chunk, State>(
  input: MakeTransportInput<Payload, Prepared, Frame, Chunk, State>,
): Adapter<Payload, Prepared> {
  const protocol = input.protocol
  const decodeChunkEffect = Schema.decodeUnknownEffect(protocol.chunk)
  const decodeChunk = (route: string) => (frame: Frame) =>
    decodeChunkEffect(frame).pipe(
      Effect.mapError(() =>
        ProviderShared.chunkError(
          input.id,
          `Invalid ${route} stream chunk`,
          typeof frame === "string" ? frame : ProviderShared.encodeJson(frame),
        ),
      ),
    )

  return register({
    id: input.id,
    protocol: protocol.id,
    transport: input.transport.id,
    payloadSchema: protocol.payload,
    toPayload: protocol.toPayload,
    prepareTransport: input.transport.prepare,
    streamPrepared: (prepared, ctx, runtime) => {
      const route = `${ctx.request.model.provider}/${ctx.request.model.adapter}`
      const chunks = input.transport.frames(prepared, ctx, runtime).pipe(
        Stream.mapEffect(decodeChunk(route)),
        protocol.terminal ? Stream.takeUntil(protocol.terminal) : (stream) => stream,
      )
      return chunks.pipe(
        Stream.mapAccumEffect(protocol.initial, protocol.process, protocol.onHalt ? { onHalt: protocol.onHalt } : undefined),
        Stream.catchCause((cause) => Stream.fail(streamError(route, `Failed to read ${route} stream`, cause))),
      )
    },
  })
}

export function make<Payload, Prepared, Frame, Chunk, State>(
  input: MakeTransportInput<Payload, Prepared, Frame, Chunk, State>,
): Adapter<Payload, Prepared>
/**
 * Build an `Adapter` by composing the four orthogonal pieces of a deployment:
 *
 * - `Protocol` — what is the API I'm speaking?
 * - `Endpoint` — where do I send the request?
 * - `Auth` — how do I authenticate it?
 * - `Framing` — how do I cut the response stream into protocol frames?
 *
 * Plus optional `headers` for cross-cutting deployment concerns (provider
 * version pins, per-deployment quirks).
 *
 * This is the canonical adapter constructor. If a new adapter does not fit
 * this four-axis model, add a purpose-built constructor rather than widening
 * the public surface preemptively.
 */
export function make<Payload, Frame, Chunk, State>(
  input: MakeInput<Payload, Frame, Chunk, State>,
): Adapter<Payload, HttpTransport.HttpPrepared<Frame>>
export function make<Payload, Prepared, Frame, Chunk, State>(
  input: MakeInput<Payload, Frame, Chunk, State> | MakeTransportInput<Payload, Prepared, Frame, Chunk, State>,
): Adapter<Payload, Prepared> | Adapter<Payload, HttpTransport.HttpPrepared<Frame>> {
  if ("transport" in input) return makeFromTransport(input)
  const protocol = input.protocol
  const encodePayload = Schema.encodeSync(Schema.fromJsonString(protocol.payload))
  return makeFromTransport({
    id: input.id,
    protocol,
    transport: HttpTransport.httpJson({
      endpoint: input.endpoint,
      auth: input.auth,
      framing: input.framing,
      encodePayload,
      headers: input.headers,
    }),
  })
}

// `compile` is the important boundary: it turns a common `LLMRequest` into a
// validated provider payload plus transport-private prepared data, but does not
// execute transport.
const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
  const resolved = resolveRequestOptions(request)
  const adapter = registeredAdapter(resolved.model.adapter)
  if (!adapter) return yield* noAdapter(resolved.model)

  const payload = yield* adapter.toPayload(resolved).pipe(
    Effect.flatMap(ProviderShared.validateWith(Schema.decodeUnknownEffect(adapter.payloadSchema))),
  )
  const prepared = yield* adapter.prepareTransport(payload, {
    request: resolved,
  })

  return {
    request: resolved,
    adapter,
    payload,
    prepared,
  }
})

const prepareWith = Effect.fn("LLMClient.prepare")(function* (request: LLMRequest) {
  const compiled = yield* compile(request)

  return new PreparedRequest({
    id: compiled.request.id ?? "request",
    adapter: compiled.adapter.id,
    model: compiled.request.model,
    payload: compiled.payload,
    metadata: { transport: compiled.adapter.transport },
  })
})

const streamRequestWith = (runtime: TransportRuntime) => (request: LLMRequest) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const compiled = yield* compile(request)
      return compiled.adapter.streamPrepared(compiled.prepared, { request: compiled.request }, runtime)
    }),
  )

const isToolRunOptions = (input: LLMRequest | ToolRuntime.RunOptions<Tools>): input is ToolRuntime.RunOptions<Tools> =>
  "request" in input && "tools" in input

const streamWith = (streamRequest: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>): StreamMethod =>
  ((input: LLMRequest | ToolRuntime.RunOptions<Tools>) => {
    if (isToolRunOptions(input)) return ToolRuntime.stream({ ...input, stream: streamRequest })
    return streamRequest(input)
  }) as StreamMethod

const generateWith = (stream: Interface["stream"]) => Effect.fn("LLM.generate")(function* (input: LLMRequest | ToolRuntime.RunOptions<Tools>) {
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

export const prepare = <Payload = unknown>(request: LLMRequest) =>
  prepareWith(request) as Effect.Effect<PreparedRequestOf<Payload>, LLMError>

export function stream(request: LLMRequest): Stream.Stream<LLMEvent, LLMError>
export function stream<T extends Tools>(options: ToolRuntime.RunOptions<T>): Stream.Stream<LLMEvent, LLMError>
export function stream(input: LLMRequest | ToolRuntime.RunOptions<Tools>) {
  return Stream.unwrap(Effect.gen(function* () {
    return (yield* Service).stream(input as never)
  }))
}

export function generate(request: LLMRequest): Effect.Effect<LLMResponse, LLMError>
export function generate<T extends Tools>(options: ToolRuntime.RunOptions<T>): Effect.Effect<LLMResponse, LLMError>
export function generate(input: LLMRequest | ToolRuntime.RunOptions<Tools>) {
  return Effect.gen(function* () {
    return yield* (yield* Service).generate(input as never)
  })
}

export const streamRequest = (request: LLMRequest) =>
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Service).stream(request)
  }))

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const stream = streamWith(streamRequestWith({ http: yield* RequestExecutor.Service }))
    return Service.of({ prepare: prepareWith as Interface["prepare"], stream, generate: generateWith(stream) })
  }),
)

export const layerWithWebSocket: Layer.Layer<Service, never, RequestExecutor.Service | WebSocketExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const stream = streamWith(streamRequestWith({
      http: yield* RequestExecutor.Service,
      webSocket: yield* WebSocketExecutor.Service,
    }))
    return Service.of({ prepare: prepareWith as Interface["prepare"], stream, generate: generateWith(stream) })
  }),
)

export const Adapter = { make, model } as const

export const LLMClient = {
  Service,
  layer,
  layerWithWebSocket,
  prepare,
  stream,
  generate,
  stepCountIs: ToolRuntime.stepCountIs,
} as const
