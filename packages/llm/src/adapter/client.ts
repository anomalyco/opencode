import { Context, Effect, Layer, Schema, Stream } from "effect"
import { Headers, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import { Auth, type Auth as AuthDef } from "./auth"
import { type Endpoint, render as renderEndpoint } from "./endpoint"
import { RequestExecutor } from "./executor"
import type { Framing } from "./framing"
import type { Protocol } from "./protocol"
import * as ProviderShared from "../protocols/shared"
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
  NoAdapterError,
  PreparedRequest,
  ProviderID,
  mergeGenerationOptions,
  mergeHttpOptions,
  mergeJsonRecords,
  mergeProviderOptions,
} from "../schema"

export interface HttpContext {
  readonly request: LLMRequest
}

export interface Adapter<Payload> {
  readonly id: string
  readonly protocol: ProtocolID
  readonly payloadSchema: Schema.Codec<Payload, unknown>
  readonly toPayload: (request: LLMRequest) => Effect.Effect<Payload, LLMError>
  readonly toHttp: (
    payload: Payload,
    context: HttpContext,
  ) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (
    response: HttpClientResponse.HttpClientResponse,
    context: HttpContext,
  ) => Stream.Stream<LLMEvent, LLMError>
}

// Adapter registries intentionally erase payload generics after construction.
// Normal call sites use `OpenAIChat.adapter`; callers only need payload types
// when preparing a request with a protocol-specific type assertion.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyAdapter = Adapter<any>

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

export interface AdapterModelOptions<Input, Output extends AdapterMappedModelInput = AdapterMappedModelInput> {
  readonly mapInput?: (input: Input) => Output
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
function model<Input extends AdapterMappedModelInput>(
  adapter: AnyAdapter,
  defaults: Partial<Omit<ModelRefInput, "id" | "adapter" | "protocol">> = {},
  options: AdapterModelOptions<Input> = {},
) {
  return (input: Input) => {
    const mapped = options.mapInput?.(input) ?? input
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
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  readonly generate: (request: LLMRequest) => Effect.Effect<LLMResponse, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLMClient") {}

const noAdapter = (model: ModelRef) =>
  new NoAdapterError({ adapter: model.adapter, protocol: model.protocol, provider: model.provider, model: model.id })

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
): Adapter<Payload> {
  const auth = input.auth ?? Auth.bearer()
  const protocol = input.protocol
  const encodePayload = Schema.encodeSync(Schema.fromJsonString(protocol.payload))
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
  const buildHeaders = input.headers ?? (() => ({}))
  const applyQuery = (url: string, query: Record<string, string> | undefined) => {
    if (!query) return url
    const next = new URL(url)
    Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value))
    return next.toString()
  }

  const toHttp = (payload: Payload, ctx: HttpContext) =>
    Effect.gen(function* () {
      const url = applyQuery(
        (yield* renderEndpoint(input.endpoint, { request: ctx.request, payload })).toString(),
        ctx.request.http?.query,
      )
      const body = ctx.request.http?.body === undefined
        ? encodePayload(payload)
        : ProviderShared.isRecord(payload)
        ? ProviderShared.encodeJson(mergeJsonRecords(payload, ctx.request.http.body) ?? {})
        : yield* ProviderShared.invalidRequest("http.body can only overlay JSON object request bodies")
      const merged = Headers.fromInput({
        ...buildHeaders({ request: ctx.request }),
        ...ctx.request.model.headers,
        ...ctx.request.http?.headers,
      })
      const headers = yield* Auth.toEffect(Auth.isAuth(ctx.request.model.auth) ? ctx.request.model.auth : auth)({
        request: ctx.request,
        method: "POST",
        url,
        body,
        headers: merged,
      })
      return ProviderShared.jsonPost({ url, body, headers })
    })

  const parse = (response: HttpClientResponse.HttpClientResponse, ctx: HttpContext) =>
    ProviderShared.framed({
      adapter: `${ctx.request.model.provider}/${ctx.request.model.adapter}`,
      response,
      readError: `Failed to read ${ctx.request.model.provider}/${ctx.request.model.adapter} stream`,
      framing: input.framing.frame,
      decodeChunk: decodeChunk(`${ctx.request.model.provider}/${ctx.request.model.adapter}`),
      initial: protocol.initial,
      process: protocol.process,
      onHalt: protocol.onHalt,
    })

  return register({
    id: input.id,
    protocol: protocol.id,
    payloadSchema: protocol.payload,
    toPayload: protocol.toPayload,
    toHttp,
    parse,
  })
}

// `compile` is the important boundary: it turns a common `LLMRequest` into a
// validated provider payload plus HTTP request, but does not execute transport.
const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
  const resolved = resolveRequestOptions(request)
  const adapter = registeredAdapter(resolved.model.adapter)
  if (!adapter) return yield* noAdapter(resolved.model)

  const payload = yield* adapter.toPayload(resolved).pipe(
    Effect.flatMap(ProviderShared.validateWith(Schema.decodeUnknownEffect(adapter.payloadSchema))),
  )
  const http = yield* adapter.toHttp(payload, {
    request: resolved,
  })

  return {
    request: resolved,
    adapter,
    payload,
    http,
  }
})

const prepareWith = Effect.fn("LLMClient.prepare")(function* (request: LLMRequest) {
  const compiled = yield* compile(request)

  return new PreparedRequest({
    id: compiled.request.id ?? "request",
    adapter: compiled.adapter.id,
    model: compiled.request.model,
    payload: compiled.payload,
  })
})

const streamWith = (executor: RequestExecutor.Interface) => (request: LLMRequest) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const compiled = yield* compile(request)
      const response = yield* executor.execute(compiled.http)

      return compiled.adapter.parse(response, { request: compiled.request })
    }),
  )

const generateWith = (stream: Interface["stream"]) => Effect.fn("LLM.generate")(function* (request: LLMRequest) {
  return new LLMResponse(
    yield* stream(request).pipe(
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

export const stream = (request: LLMRequest) =>
  Stream.unwrap(Effect.gen(function* () {
    return (yield* Service).stream(request)
  }))

export const generate = (request: LLMRequest) =>
  Effect.gen(function* () {
    return yield* (yield* Service).generate(request)
  })

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const stream = streamWith(yield* RequestExecutor.Service)
    return Service.of({ prepare: prepareWith as Interface["prepare"], stream, generate: generateWith(stream) })
  }),
)

export const Adapter = { make, model } as const

export const LLMClient = {
  Service,
  layer,
  prepare,
  stream,
  generate,
} as const
