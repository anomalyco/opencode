import { Effect, Schema, Stream } from "effect"
import { HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import type { Auth } from "./auth"
import { bearer as authBearer } from "./auth"
import type { Endpoint } from "./endpoint"
import { RequestExecutor } from "./executor"
import type { AnyPatch, Patch, PatchInput, PatchRegistry } from "./patch"
import { context, emptyRegistry, plan, registry as makePatchRegistry, target as targetPatch } from "./patch"
import type { Framing } from "./framing"
import type { Protocol } from "./protocol"
import { ProviderShared } from "./provider/shared"
import type {
  LLMError,
  LLMEvent,
  ModelRef,
  PatchTrace,
  PreparedRequestOf,
  ProtocolID,
} from "./schema"
import {
  LLMRequest,
  LLMResponse,
  InvalidRequestError,
  NoAdapterError,
  PreparedRequest,
} from "./schema"

export interface HttpContext {
  readonly request: LLMRequest
  readonly patchTrace: ReadonlyArray<PatchTrace>
}

export interface Adapter<Target> {
  readonly id: string
  readonly protocol: ProtocolID
  readonly patches: ReadonlyArray<Patch<Target>>
  readonly prepare: (request: LLMRequest) => Effect.Effect<Target, LLMError>
  readonly validate: (target: Target) => Effect.Effect<Target, LLMError>
  readonly toHttp: (
    target: Target,
    context: HttpContext,
  ) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (
    response: HttpClientResponse.HttpClientResponse,
    context: HttpContext,
  ) => Stream.Stream<LLMEvent, LLMError>
}

export type AdapterInput<Target> = Omit<Adapter<Target>, "patches"> & {
  readonly patches?: ReadonlyArray<Patch<Target>>
}

export interface AdapterDefinition<Target> extends Adapter<Target> {
  readonly patch: (id: string, input: PatchInput<Target>) => Patch<Target>
  readonly withPatches: (patches: ReadonlyArray<Patch<Target>>) => AdapterDefinition<Target>
}

// Adapter registries intentionally erase target generics after the typed
// adapter is constructed. This keeps normal call sites on `OpenAIChat.adapter`
// instead of leaking a separate runtime-adapter wrapper.
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type AnyAdapter = AdapterDefinition<any>

const modelAdapters = new WeakMap<ModelRef, AnyAdapter>()

export const bindModel = <Model extends ModelRef>(model: Model, adapter: AnyAdapter): Model => {
  if (model.protocol !== adapter.protocol) {
    throw new Error(
      `Cannot bind ${adapter.id} adapter (${adapter.protocol}) to ${model.provider}/${model.id} (${model.protocol})`,
    )
  }
  modelAdapters.set(model, adapter)
  return model
}

export const preserveModelBinding = <Model extends ModelRef>(source: ModelRef, target: Model): Model => {
  const adapter = modelAdapters.get(source)
  if (!adapter) return target
  return bindModel(target, adapter)
}

export interface LLMClient {
  /**
   * Compile a request through the adapter pipeline (patches, prepare,
   * protocol target validation, toHttp) without sending it. Returns the
   * prepared request including the provider-native target.
   *
   * Pass a `Target` type argument to statically expose the adapter's target
   * shape (e.g. `prepare<OpenAIChatTarget>(...)`) — the runtime payload is
   * identical, so this is a type-level assertion the caller makes about which
   * adapter the request will resolve to.
   */
  readonly prepare: <Target = unknown>(request: LLMRequest) => Effect.Effect<PreparedRequestOf<Target>, LLMError>
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service>
  readonly generate: (request: LLMRequest) => Effect.Effect<LLMResponse, LLMError, RequestExecutor.Service>
}

export interface ClientOptions {
  readonly adapters?: ReadonlyArray<AnyAdapter>
  readonly patches?: PatchRegistry | ReadonlyArray<AnyPatch>
}

const noAdapter = (model: ModelRef) =>
  new NoAdapterError({ protocol: model.protocol, provider: model.provider, model: model.id })

const ensureSameRoute = (original: ModelRef, next: ModelRef) =>
  Effect.gen(function* () {
    if (next.provider === original.provider && next.id === original.id && next.protocol === original.protocol) return
    return yield* new InvalidRequestError({
      message: `Patches cannot change model routing (${original.provider}/${original.id}/${original.protocol} -> ${next.provider}/${next.id}/${next.protocol})`,
    })
  })

const normalizeRegistry = (patches: PatchRegistry | ReadonlyArray<AnyPatch> | undefined): PatchRegistry => {
  if (!patches) return emptyRegistry
  if ("request" in patches) return patches
  return makePatchRegistry(patches)
}

export interface MakeInput<Target, Frame, Chunk, State> {
  /** Adapter id used in registry lookup, error messages, and patch namespaces. */
  readonly id: string
  /** Semantic API contract — owns lowering, target schema, and parsing. */
  readonly protocol: Protocol<Target, Frame, Chunk, State>
  /** Where the request is sent. */
  readonly endpoint: Endpoint<Target>
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
  readonly patches?: ReadonlyArray<Patch<Target>>
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
export function make<Target, Frame, Chunk, State>(
  input: MakeInput<Target, Frame, Chunk, State>,
): AdapterDefinition<Target> {
  const auth = input.auth ?? authBearer
  const protocol = input.protocol
  const validateTarget = ProviderShared.validateWith(Schema.decodeUnknownEffect(protocol.target))
  const encodeTarget = Schema.encodeSync(Schema.fromJsonString(protocol.target))
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

  const toHttp = (target: Target, ctx: HttpContext) =>
    Effect.gen(function* () {
      const url = (yield* input.endpoint({ request: ctx.request, target })).toString()
      const body = encodeTarget(target)
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

  const build = (patches: ReadonlyArray<Patch<Target>>): AdapterDefinition<Target> => ({
    id: input.id,
    protocol: input.protocolId ?? protocol.id,
    patches,
    prepare: protocol.prepare,
    validate: validateTarget,
    toHttp,
    parse,
    patch: (id, patchInput) => targetPatch(`${input.id}.${id}`, patchInput),
    withPatches: (next) => build([...patches, ...next]),
  })

  return build(input.patches ?? [])
}

/**
 * Build the lower-level runtime. `compile` is the important boundary: it turns
 * a common `LLMRequest` into a validated provider target plus HTTP request,
 * but does not execute transport.
 */
const makeClient = (options: ClientOptions): LLMClient => {
  const registry = normalizeRegistry(options.patches)
  const adapters = new Map((options.adapters ?? []).map((adapter) => [adapter.protocol, adapter] as const))

  const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
    // Routing is fixed up front. Patches can reshape payloads, but cannot
    // silently move a request to a different provider/model/protocol.
    const adapter = adapters.get(request.model.protocol) ?? modelAdapters.get(request.model)
    if (!adapter) return yield* noAdapter(request.model)

    // Request-shaped phases run before adapter lowering so provider quirks can
    // clean up prompt content and tool schemas while staying traceable.
    const requestPlan = plan({
      phase: "request",
      context: context({ request }),
      patches: registry.request,
    })
    const requestAfterRequestPatches = requestPlan.apply(request)
    yield* ensureSameRoute(request.model, requestAfterRequestPatches.model)

    const promptPlan = plan({
      phase: "prompt",
      context: context({ request: requestAfterRequestPatches }),
      patches: registry.prompt,
    })
    const requestBeforeToolPatches = promptPlan.apply(requestAfterRequestPatches)
    yield* ensureSameRoute(request.model, requestBeforeToolPatches.model)

    const toolSchemaPlan = plan({
      phase: "tool-schema",
      context: context({ request: requestBeforeToolPatches }),
      patches: registry.toolSchema,
    })
    const patchedRequest =
      requestBeforeToolPatches.tools.length === 0 || toolSchemaPlan.patches.length === 0
        ? requestBeforeToolPatches
        : new LLMRequest({
            ...requestBeforeToolPatches,
            tools: requestBeforeToolPatches.tools.map(toolSchemaPlan.apply),
          })

    // Adapter prepare lowers common messages/options into the provider target.
    // Target patches run after lowering because they speak provider-native body
    // shape rather than common request shape.
    const patchContext = context({ request: patchedRequest })
    const candidate = yield* adapter.prepare(patchedRequest)
    const targetPlan = plan({
      phase: "target",
      context: patchContext,
      patches: [...adapter.patches, ...registry.target],
    })
    const target = yield* adapter.validate(targetPlan.apply(candidate))
    const targetPatchTrace = [
      ...requestPlan.trace,
      ...promptPlan.trace,
      ...(requestBeforeToolPatches.tools.length === 0 || toolSchemaPlan.patches.length === 0
        ? []
        : toolSchemaPlan.trace),
      ...targetPlan.trace,
    ]

    const http = yield* adapter.toHttp(target, { request: patchedRequest, patchTrace: targetPatchTrace })

    return { request: patchedRequest, adapter, target, http, patchTrace: targetPatchTrace }
  })

  const prepare = Effect.fn("LLM.prepare")(function* (request: LLMRequest) {
    const compiled = yield* compile(request)

    return new PreparedRequest({
      id: compiled.request.id ?? "request",
      adapter: compiled.adapter.id,
      model: compiled.request.model,
      target: compiled.target,
      patchTrace: compiled.patchTrace,
    })
  })

  const stream = (request: LLMRequest) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const compiled = yield* compile(request)
        const executor = yield* RequestExecutor.Service
        const response = yield* executor.execute(compiled.http)

        const streamPlan = plan({
          phase: "stream",
          context: context({ request: compiled.request }),
          patches: registry.stream,
        })
        const events = compiled.adapter.parse(response, { request: compiled.request, patchTrace: compiled.patchTrace })

        if (streamPlan.patches.length === 0) return events
        return events.pipe(Stream.map(streamPlan.apply))
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

  // The runtime always emits a `PreparedRequest` (target: unknown). Callers
  // who supply a `Target` type argument assert the shape they expect from
  // their adapter; the cast hands them a typed view of the same payload.
  return { prepare: prepare as LLMClient["prepare"], stream, generate }
}

export const Adapter = { bindModel, make } as const

export const LLMClient = { make: makeClient }
