import { Effect, Schema, Stream } from "effect"
import { HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import type { Auth } from "./auth"
import { bearer as authBearer } from "./auth"
import { type Endpoint, render as renderEndpoint } from "./endpoint"
import { RequestExecutor } from "./executor"
import type { Framing } from "./framing"
import type { Protocol } from "./protocol"
import * as ProviderShared from "../protocols/shared"
import type {
  AdapterID,
  GenerationOptionsInput,
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

export type AdapterInput<Payload> = Adapter<Payload>

export interface AdapterDefinition<Payload> extends Adapter<Payload> {}

// Adapter registries intentionally erase payload generics after the typed
// adapter is constructed. This keeps normal call sites on `OpenAIChat.adapter`
// instead of leaking a separate runtime-adapter wrapper.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyAdapter = AdapterDefinition<any>

const adapterRegistry = new Map<string, AnyAdapter>()

// The first adapter registered for an id is the package default. Tests and
// advanced callers can still override per-client via `LLMClient.make({ adapters })`.
const register = <Adapter extends AnyAdapter>(adapter: Adapter): Adapter => {
  if (!adapterRegistry.has(adapter.id)) adapterRegistry.set(adapter.id, adapter)
  return adapter
}

const registeredAdapter = (id: string) => adapterRegistry.get(id)

export type ModelCapabilitiesInput = {
  readonly input?: Partial<ModelCapabilities["input"]>
  readonly output?: Partial<ModelCapabilities["output"]>
  readonly tools?: Partial<ModelCapabilities["tools"]>
  readonly cache?: Partial<ModelCapabilities["cache"]>
  readonly reasoning?: Partial<Omit<ModelCapabilities["reasoning"], "efforts">> & {
    readonly efforts?: ReadonlyArray<ModelCapabilities["reasoning"]["efforts"][number]>
  }
}

export type HttpOptionsInput = HttpOptions | ConstructorParameters<typeof HttpOptions>[0]

export type ModelRefInput = Omit<
  ConstructorParameters<typeof ModelRef>[0],
  "id" | "provider" | "adapter" | "capabilities" | "limits" | "generation" | "http"
> & {
  readonly id: string | ModelID
  readonly provider: string | ProviderID
  readonly adapter?: string | AdapterID
  readonly capabilities?: ModelCapabilities | ModelCapabilitiesInput
  readonly limits?: ModelLimits | ConstructorParameters<typeof ModelLimits>[0]
  readonly generation?: GenerationOptionsInput
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

export const modelCapabilities = (input: ModelCapabilities | ModelCapabilitiesInput | undefined) => {
  if (input instanceof ModelCapabilities) return input
  return new ModelCapabilities({
    input: { text: true, image: false, audio: false, video: false, pdf: false, ...input?.input },
    output: { text: true, reasoning: false, ...input?.output },
    tools: { calls: false, streamingInput: false, providerExecuted: false, ...input?.tools },
    cache: { prompt: false, messageBlocks: false, contentBlocks: false, ...input?.cache },
    reasoning: { efforts: [], summaries: false, encryptedContent: false, ...input?.reasoning },
  })
}

export const modelLimits = (input: ModelLimits | ConstructorParameters<typeof ModelLimits>[0] | undefined) => {
  if (input instanceof ModelLimits) return input
  return new ModelLimits(input ?? {})
}

export const generationOptions = (input: GenerationOptionsInput | undefined) => {
  if (input === undefined || input instanceof GenerationOptions) return input
  return new GenerationOptions(input)
}

export const httpOptions = (input: HttpOptionsInput | undefined) => {
  if (input === undefined || input instanceof HttpOptions) return input
  return new HttpOptions(input)
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

export interface LLMClient {
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
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service>
  readonly generate: (request: LLMRequest) => Effect.Effect<LLMResponse, LLMError, RequestExecutor.Service>
}

export interface ClientOptions {
  readonly adapters?: ReadonlyArray<AnyAdapter>
}

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
  /**
   * Per-request transport authentication. Defaults to `Auth.bearer`, which
   * sets `Authorization: Bearer <model.apiKey>` when `model.apiKey` is set
   * and is a no-op otherwise. Override with `Auth.apiKeyHeader(name)` for
   * providers that use a custom header (Anthropic, Gemini), or supply a
   * custom `Auth` for per-request signing (Bedrock SigV4).
   */
  readonly auth?: Auth
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
): AdapterDefinition<Payload> {
  const auth = input.auth ?? authBearer
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
      const merged = { ...buildHeaders({ request: ctx.request }), ...ctx.request.model.headers, ...ctx.request.http?.headers }
      const headers = yield* auth({
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

/**
 * Build the lower-level runtime. `compile` is the important boundary: it turns
 * a common `LLMRequest` into a validated provider payload plus HTTP request,
 * but does not execute transport.
 */
const makeClient = (options: ClientOptions = {}): LLMClient => {
  const adapters = new Map((options.adapters ?? []).map((adapter) => [adapter.id, adapter] as const))

  const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
    const resolved = resolveRequestOptions(request)
    const adapter = adapters.get(resolved.model.adapter) ?? registeredAdapter(resolved.model.adapter)
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

  const prepare = Effect.fn("LLMClient.prepare")(function* (request: LLMRequest) {
    const compiled = yield* compile(request)

    return new PreparedRequest({
      id: compiled.request.id ?? "request",
      adapter: compiled.adapter.id,
      model: compiled.request.model,
      payload: compiled.payload,
    })
  })

  const stream = (request: LLMRequest) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const compiled = yield* compile(request)
        const executor = yield* RequestExecutor.Service
        const response = yield* executor.execute(compiled.http)

        return compiled.adapter.parse(response, { request: compiled.request })
      }),
    )

  const generate = Effect.fn("LLM.generate")(function* (request: LLMRequest) {
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

  // The runtime always emits a `PreparedRequest` (payload: unknown). Callers
  // who supply a `Payload` type argument assert the shape they expect from
  // their adapter; the cast hands them a typed view of the same payload.
  return { prepare: prepare as LLMClient["prepare"], stream, generate }
}

export const Adapter = { make, model } as const

export const LLMClient = { make: makeClient }
