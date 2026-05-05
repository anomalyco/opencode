import { Effect, Schema, Stream } from "effect"
import { HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import type { Auth } from "./auth"
import { bearer as authBearer } from "./auth"
import { type Endpoint, render as renderEndpoint } from "./endpoint"
import { RequestExecutor } from "./executor"
import type { AnyPatch, Patch, PatchInput, PatchRegistry } from "./patch"
import { payload as payloadPatch } from "./patch"
import { PatchPipeline } from "./patch-pipeline"
import type { Framing } from "./framing"
import type { Protocol } from "./protocol"
import { ProviderShared } from "./protocols/shared"
import type {
  LLMError,
  LLMEvent,
  LLMRequest,
  PatchTrace,
  PreparedRequestOf,
  ProtocolID,
} from "./schema"
import {
  LLMResponse,
  ModelCapabilities,
  ModelID,
  ModelLimits,
  ModelRef,
  NoAdapterError,
  PreparedRequest,
  ProviderID,
} from "./schema"

export interface HttpContext {
  readonly request: LLMRequest
  readonly patchTrace: ReadonlyArray<PatchTrace>
}

export interface Adapter<Payload> {
  readonly id: string
  readonly protocol: ProtocolID
  readonly payloadSchema: Schema.Codec<Payload, unknown>
  readonly patches: ReadonlyArray<Patch<Payload>>
  readonly prepare: (request: LLMRequest) => Effect.Effect<Payload, LLMError>
  readonly toHttp: (
    payload: Payload,
    context: HttpContext,
  ) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (
    response: HttpClientResponse.HttpClientResponse,
    context: HttpContext,
  ) => Stream.Stream<LLMEvent, LLMError>
}

export type AdapterInput<Payload> = Omit<Adapter<Payload>, "patches"> & {
  readonly patches?: ReadonlyArray<Patch<Payload>>
}

export interface AdapterDefinition<Payload> extends Adapter<Payload> {
  readonly patch: (id: string, input: PatchInput<Payload>) => Patch<Payload>
  readonly withPatches: (patches: ReadonlyArray<Patch<Payload>>) => AdapterDefinition<Payload>
}

// Adapter registries intentionally erase payload generics after the typed
// adapter is constructed. This keeps normal call sites on `OpenAIChat.adapter`
// instead of leaking a separate runtime-adapter wrapper.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyAdapter = AdapterDefinition<any>

const modelAdapters = new WeakMap<ModelRef, AnyAdapter>()

export type ModelCapabilitiesInput = {
  readonly input?: Partial<ModelCapabilities["input"]>
  readonly output?: Partial<ModelCapabilities["output"]>
  readonly tools?: Partial<ModelCapabilities["tools"]>
  readonly cache?: Partial<ModelCapabilities["cache"]>
  readonly reasoning?: Partial<Omit<ModelCapabilities["reasoning"], "efforts">> & {
    readonly efforts?: ReadonlyArray<ModelCapabilities["reasoning"]["efforts"][number]>
  }
}

export type ModelRefInput = Omit<
  ConstructorParameters<typeof ModelRef>[0],
  "id" | "provider" | "capabilities" | "limits"
> & {
  readonly id: string | ModelID
  readonly provider: string | ProviderID
  readonly capabilities?: ModelCapabilities | ModelCapabilitiesInput
  readonly limits?: ModelLimits | ConstructorParameters<typeof ModelLimits>[0]
}

export type AdapterModelInput = Omit<ModelRefInput, "provider" | "protocol">

export type AdapterModelDefaults = Omit<ModelRefInput, "id" | "protocol">

export type AdapterRoutedModelInput = Omit<ModelRefInput, "protocol">

export type AdapterRoutedModelDefaults = Partial<Omit<ModelRefInput, "id" | "provider" | "protocol">>

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

export const modelRef = (input: ModelRefInput) =>
  new ModelRef({
    ...input,
    id: ModelID.make(input.id),
    provider: ProviderID.make(input.provider),
    protocol: input.protocol,
    capabilities: modelCapabilities(input.capabilities),
    limits: modelLimits(input.limits),
  })

export const bindModel = <Model extends ModelRef>(model: Model, adapter: AnyAdapter): Model => {
  if (model.protocol !== adapter.protocol) {
    throw new Error(
      `Cannot bind ${adapter.id} adapter (${adapter.protocol}) to ${model.provider}/${model.id} (${model.protocol})`,
    )
  }
  modelAdapters.set(model, adapter)
  return model
}

function model<Input extends AdapterModelInput = AdapterModelInput>(
  adapter: AnyAdapter,
  defaults: AdapterModelDefaults,
): (input: Input) => ModelRef
function model<Input extends AdapterRoutedModelInput = AdapterRoutedModelInput>(
  adapter: AnyAdapter,
  defaults?: AdapterRoutedModelDefaults,
): (input: Input) => ModelRef
function model(adapter: AnyAdapter, defaults: Partial<Omit<ModelRefInput, "id" | "protocol">> = {}) {
  return (input: AdapterRoutedModelInput) => {
    const provider = defaults.provider ?? input.provider
    if (!provider) throw new Error(`Adapter.model(${adapter.id}) requires a provider`)
    return bindModel(
      modelRef({
        ...defaults,
        ...input,
        provider,
        protocol: adapter.protocol,
        capabilities: input.capabilities ?? defaults.capabilities,
        limits: input.limits ?? defaults.limits,
      }),
      adapter,
    )
  }
}

export const preserveModelBinding = <Model extends ModelRef>(source: ModelRef, target: Model): Model => {
  const adapter = modelAdapters.get(source)
  if (!adapter) return target
  return bindModel(target, adapter)
}

export interface LLMClient {
  /**
   * Compile a request through the adapter pipeline (patches, prepare,
   * protocol payload validation, toHttp) without sending it. Returns the
   * prepared request including the provider-native payload.
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
  readonly patches?: PatchRegistry | ReadonlyArray<AnyPatch>
}

const noAdapter = (model: ModelRef) =>
  new NoAdapterError({ protocol: model.protocol, provider: model.provider, model: model.id })

export interface MakeInput<Payload, Frame, Chunk, State> {
  /** Adapter id used in registry lookup, error messages, and patch namespaces. */
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
  /** Provider patches that target this adapter (e.g. include-usage). */
  readonly patches?: ReadonlyArray<Patch<Payload>>
  /**
   * Optional override for the adapter's protocol id. Defaults to
   * `protocol.id`. Only set when an adapter intentionally registers under a
   * different protocol than the wire it speaks (today: OpenAI-compatible Chat
   * uses OpenAI Chat protocol but registers under `openai-compatible-chat`).
   */
  readonly protocolId?: ProtocolID
}

/**
 * Build an `Adapter` by composing the four orthogonal pieces of a deployment:
 *
 * - `Protocol` — what is the API I'm speaking?
 * - `Endpoint` — where do I send the request?
 * - `Auth` — how do I authenticate it?
 * - `Framing` — how do I cut the response stream into protocol frames?
 *
 * Plus optional `headers` and `patches` for cross-cutting deployment concerns
 * (provider version pins, per-deployment quirks).
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

  const toHttp = (payload: Payload, ctx: HttpContext) =>
    Effect.gen(function* () {
      const url = (yield* renderEndpoint(input.endpoint, { request: ctx.request, payload })).toString()
      const body = encodePayload(payload)
      const merged = { ...buildHeaders({ request: ctx.request }), ...ctx.request.model.headers }
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
      adapter: `${ctx.request.model.provider}/${ctx.request.model.protocol}`,
      response,
      readError: `Failed to read ${ctx.request.model.provider}/${ctx.request.model.protocol} stream`,
      framing: input.framing.frame,
      decodeChunk: decodeChunk(`${ctx.request.model.provider}/${ctx.request.model.protocol}`),
      initial: protocol.initial,
      process: protocol.process,
      onHalt: protocol.onHalt,
    })

  const patches = input.patches ?? []

  return {
    id: input.id,
    protocol: input.protocolId ?? protocol.id,
    payloadSchema: protocol.payload,
    patches,
    prepare: protocol.prepare,
    toHttp,
    parse,
    patch: (id, patchInput) => payloadPatch(`${input.id}.${id}`, patchInput),
    withPatches: (next) => make({ ...input, patches: [...patches, ...next] }),
  }
}

/**
 * Build the lower-level runtime. `compile` is the important boundary: it turns
 * a common `LLMRequest` into a validated provider payload plus HTTP request,
 * but does not execute transport.
 */
const makeClient = (options: ClientOptions): LLMClient => {
  const pipeline = PatchPipeline.make(options.patches)
  const adapters = new Map((options.adapters ?? []).map((adapter) => [adapter.protocol, adapter] as const))

  const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
    const adapter = adapters.get(request.model.protocol) ?? modelAdapters.get(request.model)
    if (!adapter) return yield* noAdapter(request.model)

    const patchedRequest = yield* pipeline.patchRequest(request)
    const candidate = yield* adapter.prepare(patchedRequest.request)
    const patchedPayload = yield* pipeline.patchPayload({
      state: patchedRequest,
      payload: candidate,
      adapterPatches: adapter.patches,
      schema: adapter.payloadSchema,
    })
    const http = yield* adapter.toHttp(patchedPayload.payload, {
      request: patchedPayload.request,
      patchTrace: patchedPayload.trace,
    })

    return {
      request: patchedPayload.request,
      adapter,
      payload: patchedPayload.payload,
      http,
      patchTrace: patchedPayload.trace,
    }
  })

  const prepare = Effect.fn("LLM.prepare")(function* (request: LLMRequest) {
    const compiled = yield* compile(request)

    return new PreparedRequest({
      id: compiled.request.id ?? "request",
      adapter: compiled.adapter.id,
      model: compiled.request.model,
      payload: compiled.payload,
      patchTrace: compiled.patchTrace,
    })
  })

  const stream = (request: LLMRequest) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const compiled = yield* compile(request)
        const executor = yield* RequestExecutor.Service
        const response = yield* executor.execute(compiled.http)

        const events = compiled.adapter.parse(response, { request: compiled.request, patchTrace: compiled.patchTrace })

        return pipeline.patchStreamEvents({ request: compiled.request, events })
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

export const Adapter = { bindModel, make, model } as const

export const LLMClient = { make: makeClient }
