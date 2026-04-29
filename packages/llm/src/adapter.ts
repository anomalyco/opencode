import { Effect, Stream } from "effect"
import { HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import type { Auth } from "./auth"
import { bearer as authBearer } from "./auth"
import type { Endpoint } from "./endpoint"
import * as LLM from "./llm"
import { RequestExecutor } from "./executor"
import type { AnyPatch, Patch, PatchInput, PatchRegistry } from "./patch"
import { context, emptyRegistry, plan, registry as makePatchRegistry, target as targetPatch } from "./patch"
import type { Framing } from "./framing"
import type { Protocol } from "./protocol"
import { ProviderShared } from "./provider/shared"
import type { LLMError, LLMEvent, LLMRequest, ModelRef, PatchTrace, PreparedRequest, ProtocolID } from "./schema"
import { LLMResponse, NoAdapterError, PreparedRequest as PreparedRequestSchema } from "./schema"

interface RuntimeAdapter {
  readonly id: string
  readonly protocol: ProtocolID
  readonly patches: ReadonlyArray<Patch<unknown>>
  readonly redact: (target: unknown) => unknown
  readonly prepare: (request: LLMRequest) => Effect.Effect<unknown, LLMError>
  readonly validate: (draft: unknown) => Effect.Effect<unknown, LLMError>
  readonly toHttp: (target: unknown, context: HttpContext) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (response: HttpClientResponse.HttpClientResponse) => Stream.Stream<LLMEvent, LLMError>
}

interface RuntimeAdapterSource {
  readonly runtime: RuntimeAdapter
}

export interface HttpContext {
  readonly request: LLMRequest
  readonly patchTrace: ReadonlyArray<PatchTrace>
}

export interface Adapter<Draft, Target> {
  readonly id: string
  readonly protocol: ProtocolID
  readonly patches: ReadonlyArray<Patch<Draft>>
  readonly redact: (target: Target) => unknown
  readonly prepare: (request: LLMRequest) => Effect.Effect<Draft, LLMError>
  readonly validate: (draft: Draft) => Effect.Effect<Target, LLMError>
  readonly toHttp: (target: Target, context: HttpContext) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (response: HttpClientResponse.HttpClientResponse) => Stream.Stream<LLMEvent, LLMError>
}

export interface AdapterInput<Draft, Target> {
  readonly id: string
  readonly protocol: ProtocolID
  readonly patches?: ReadonlyArray<Patch<Draft>>
  readonly redact: (target: Target) => unknown
  readonly prepare: (request: LLMRequest) => Effect.Effect<Draft, LLMError>
  readonly validate: (draft: Draft) => Effect.Effect<Target, LLMError>
  readonly toHttp: (target: Target, context: HttpContext) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (response: HttpClientResponse.HttpClientResponse) => Stream.Stream<LLMEvent, LLMError>
}

export interface AdapterDefinition<Draft, Target> extends Adapter<Draft, Target> {
  readonly runtime: RuntimeAdapter
  readonly patch: (id: string, input: PatchInput<Draft>) => Patch<Draft>
  readonly withPatches: (patches: ReadonlyArray<Patch<Draft>>) => AdapterDefinition<Draft, Target>
}

export interface LLMClient {
  readonly prepare: (request: LLMRequest) => Effect.Effect<PreparedRequest, LLMError>
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service>
  readonly generate: (request: LLMRequest) => Effect.Effect<LLMResponse, LLMError, RequestExecutor.Service>
}

export interface ClientOptions {
  readonly adapters: ReadonlyArray<RuntimeAdapterSource>
  readonly patches?: PatchRegistry | ReadonlyArray<AnyPatch>
}

const noAdapter = (model: ModelRef) =>
  new NoAdapterError({ protocol: model.protocol, provider: model.provider, model: model.id })

const normalizeRegistry = (patches: PatchRegistry | ReadonlyArray<AnyPatch> | undefined): PatchRegistry => {
  if (!patches) return emptyRegistry
  if ("request" in patches) return patches
  return makePatchRegistry(patches)
}

/**
 * Lower-level adapter constructor. Reach for this only when the adapter
 * genuinely cannot fit `fromProtocol`'s four-axis model — for example, an
 * adapter that needs hand-rolled `toHttp` / `parse` because no `Protocol`,
 * `Endpoint`, `Auth`, or `Framing` value cleanly captures its behavior.
 *
 * Named `unsafe` to signal that you are escaping the safe abstraction; the
 * canonical path is `Adapter.fromProtocol(...)`. New adapters should start
 * there and prove they need otherwise before reaching for this.
 */
export function unsafe<Draft, Target>(input: AdapterInput<Draft, Target>): AdapterDefinition<Draft, Target> {
  const build = (patches: ReadonlyArray<Patch<Draft>>): AdapterDefinition<Draft, Target> => ({
    id: input.id,
    protocol: input.protocol,
    patches,
    get runtime() {
      // Runtime registry erases adapter draft/target generics after validation.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      return this as unknown as RuntimeAdapter
    },
    redact: input.redact,
    prepare: input.prepare,
    validate: input.validate,
    toHttp: input.toHttp,
    parse: input.parse,
    patch: (id, patchInput) => targetPatch(`${input.id}.${id}`, patchInput),
    withPatches: (next) => build([...patches, ...next]),
  })

  return build(input.patches ?? [])
}

export interface FromProtocolInput<Draft, Target, Frame, Chunk, State> {
  /** Adapter id used in registry lookup, error messages, and patch namespaces. */
  readonly id: string
  /** Semantic API contract — owns lowering, validation, encoding, and parsing. */
  readonly protocol: Protocol<Draft, Target, Frame, Chunk, State>
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
  /** Stream framing — bytes -> frames before `protocol.decode`. */
  readonly framing: Framing<Frame>
  /** Static / per-request headers added before `auth` runs. */
  readonly headers?: (input: { readonly request: LLMRequest }) => Record<string, string>
  /** Provider patches that target this adapter (e.g. include-usage). */
  readonly patches?: ReadonlyArray<Patch<Draft>>
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
 * This is the canonical adapter constructor. Reach for `unsafe(...)` only
 * when an adapter genuinely cannot fit the four-axis model.
 */
export function fromProtocol<Draft, Target, Frame, Chunk, State>(
  input: FromProtocolInput<Draft, Target, Frame, Chunk, State>,
): AdapterDefinition<Draft, Target> {
  const auth = input.auth ?? authBearer
  const protocol = input.protocol
  const buildHeaders = input.headers ?? (() => ({}))

  const toHttp = (target: Target, ctx: HttpContext) =>
    Effect.gen(function* () {
      const url = (yield* input.endpoint({ request: ctx.request, target })).toString()
      const body = protocol.encode(target)
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

  const parse = (response: HttpClientResponse.HttpClientResponse) =>
    ProviderShared.framed({
      adapter: input.id,
      response,
      readError: protocol.streamReadError,
      framing: input.framing.frame,
      decodeChunk: protocol.decode,
      initial: protocol.initial,
      process: protocol.process,
      onHalt: protocol.onHalt,
    })

  return unsafe({
    id: input.id,
    protocol: input.protocolId ?? protocol.id,
    patches: input.patches,
    redact: protocol.redact,
    prepare: protocol.prepare,
    validate: protocol.validate,
    toHttp,
    parse,
  })
}

const makeClient = (options: ClientOptions): LLMClient => {
  const registry = normalizeRegistry(options.patches)
  const adapters = new Map(
    options.adapters.map((source) => [source.runtime.protocol, source.runtime] as const),
  )

  const resolveAdapter = (request: LLMRequest) =>
    Effect.gen(function* () {
      const adapter = adapters.get(request.model.protocol)
      if (!adapter) return yield* noAdapter(request.model)
      return adapter
    })

  const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
    const adapter = yield* resolveAdapter(request)

    const requestPlan = plan({
      phase: "request",
      context: context({ request }),
      patches: registry.request,
    })
    const requestAfterRequestPatches = requestPlan.apply(request)
    const promptPlan = plan({
      phase: "prompt",
      context: context({ request: requestAfterRequestPatches }),
      patches: registry.prompt,
    })
    const requestBeforeToolPatches = promptPlan.apply(requestAfterRequestPatches)
    const toolSchemaPlan = plan({
      phase: "tool-schema",
      context: context({ request: requestBeforeToolPatches }),
      patches: registry.toolSchema,
    })
    const patchedRequest =
      requestBeforeToolPatches.tools.length === 0
        ? requestBeforeToolPatches
        : LLM.updateRequest(requestBeforeToolPatches, { tools: requestBeforeToolPatches.tools.map(toolSchemaPlan.apply) })
    const patchContext = context({ request: patchedRequest })
    const draft = yield* adapter.prepare(patchedRequest)
    const targetPlan = plan({
      phase: "target",
      context: patchContext,
      patches: [...adapter.patches, ...registry.target],
    })
    const target = yield* adapter.validate(targetPlan.apply(draft))
    const targetPatchTrace = [
      ...requestPlan.trace,
      ...promptPlan.trace,
      ...(requestBeforeToolPatches.tools.length === 0 ? [] : toolSchemaPlan.trace),
      ...targetPlan.trace,
    ]
    const http = yield* adapter.toHttp(target, { request: patchedRequest, patchTrace: targetPatchTrace })

    return { request: patchedRequest, adapter, target, http, patchTrace: targetPatchTrace }
  })

  const prepare = Effect.fn("LLM.prepare")(function* (request: LLMRequest) {
    const compiled = yield* compile(request)

    return new PreparedRequestSchema({
      id: compiled.request.id ?? "request",
      adapter: compiled.adapter.id,
      model: compiled.request.model,
      target: compiled.target,
      redactedTarget: compiled.adapter.redact(compiled.target),
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
        const events = compiled.adapter.parse(response)
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

  return { prepare, stream, generate }
}

export const LLMClient = { make: makeClient }

export * as Adapter from "./adapter"
