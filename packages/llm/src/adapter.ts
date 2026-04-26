import { Effect, Stream } from "effect"
import { HttpClientRequest, type HttpClientResponse } from "effect/unstable/http"
import { RequestExecutor } from "./executor"
import type { AnyPatch, Patch, PatchInput, PatchRegistry } from "./patch"
import { context, emptyRegistry, plan, registry as makePatchRegistry, target as targetPatch } from "./patch"
import type { LLMError, LLMEvent, LLMRequest, ModelRef, PatchTrace, PreparedRequest, Protocol } from "./schema"
import { LLMResponse, NoAdapterError, PreparedRequest as PreparedRequestSchema } from "./schema"

type RuntimeAdapter = Adapter<unknown, unknown, unknown>

export interface HttpContext {
  readonly request: LLMRequest
  readonly patchTrace: ReadonlyArray<PatchTrace>
}

export interface RaiseState {
  readonly request: LLMRequest
  readonly patchTrace: ReadonlyArray<PatchTrace>
}

export interface Adapter<Draft, Target, Chunk> {
  readonly id: string
  readonly protocol: Protocol
  readonly patches: ReadonlyArray<Patch<Draft>>
  readonly redact: (target: Target) => unknown
  readonly prepare: (request: LLMRequest) => Effect.Effect<Draft, LLMError>
  readonly validate: (draft: Draft) => Effect.Effect<Target, LLMError>
  readonly toHttp: (target: Target, context: HttpContext) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (response: HttpClientResponse.HttpClientResponse) => Stream.Stream<Chunk, LLMError>
  readonly raise: (chunk: Chunk, state: RaiseState) => Stream.Stream<LLMEvent, LLMError>
}

export interface AdapterInput<Draft, Target, Chunk> {
  readonly id: string
  readonly protocol: Protocol
  readonly patches?: ReadonlyArray<Patch<Draft>>
  readonly redact: (target: Target) => unknown
  readonly prepare: (request: LLMRequest) => Effect.Effect<Draft, LLMError>
  readonly validate: (draft: Draft) => Effect.Effect<Target, LLMError>
  readonly toHttp: (target: Target, context: HttpContext) => Effect.Effect<HttpClientRequest.HttpClientRequest, LLMError>
  readonly parse: (response: HttpClientResponse.HttpClientResponse) => Stream.Stream<Chunk, LLMError>
  readonly raise: (chunk: Chunk, state: RaiseState) => Stream.Stream<LLMEvent, LLMError>
}

export interface AdapterDefinition<Draft, Target, Chunk> extends Adapter<Draft, Target, Chunk> {
  readonly patch: (id: string, input: PatchInput<Draft>) => Patch<Draft>
  readonly withPatches: (patches: ReadonlyArray<Patch<Draft>>) => AdapterDefinition<Draft, Target, Chunk>
}

export interface LLMClient {
  readonly prepare: (request: LLMRequest) => Effect.Effect<PreparedRequest, LLMError>
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError, RequestExecutor.Service>
  readonly generate: (request: LLMRequest) => Effect.Effect<LLMResponse, LLMError, RequestExecutor.Service>
}

export interface ClientOptions<Draft = unknown, Target = unknown, Chunk = unknown> {
  readonly adapters: ReadonlyArray<Adapter<Draft, Target, Chunk>>
  readonly patches?: PatchRegistry | ReadonlyArray<AnyPatch>
}

const noAdapter = (model: ModelRef) =>
  new NoAdapterError({ protocol: model.protocol, provider: model.provider, model: model.id })

const runtimeAdapter = <Draft, Target, Chunk>(adapter: Adapter<Draft, Target, Chunk>): RuntimeAdapter =>
  adapter as unknown as RuntimeAdapter

const normalizeRegistry = (patches: PatchRegistry | ReadonlyArray<AnyPatch> | undefined): PatchRegistry => {
  if (!patches) return emptyRegistry
  if ("request" in patches) return patches
  return makePatchRegistry(patches)
}

export function define<Draft, Target, Chunk>(input: AdapterInput<Draft, Target, Chunk>): AdapterDefinition<Draft, Target, Chunk> {
  const build = (patches: ReadonlyArray<Patch<Draft>>): AdapterDefinition<Draft, Target, Chunk> => ({
    id: input.id,
    protocol: input.protocol,
    patches,
    redact: input.redact,
    prepare: input.prepare,
    validate: input.validate,
    toHttp: input.toHttp,
    parse: input.parse,
    raise: input.raise,
    patch: (id, patchInput) => targetPatch(`${input.id}.${id}`, patchInput),
    withPatches: (next) => build([...patches, ...next]),
  })

  return build(input.patches ?? [])
}

export function client<Draft, Target, Chunk>(options: ClientOptions<Draft, Target, Chunk>): LLMClient {
  const registry = normalizeRegistry(options.patches)
  const adapters = options.adapters.map(runtimeAdapter)

  const resolveAdapter = (request: LLMRequest) =>
    Effect.gen(function* () {
      const adapter = adapters.find((adapter) => adapter.protocol === request.model.protocol)
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
        : { ...requestBeforeToolPatches, tools: requestBeforeToolPatches.tools.map(toolSchemaPlan.apply) }
    const patchContext = context({ request: patchedRequest })
    const draft = yield* adapter.prepare(patchedRequest)
    const targetPlan = plan({
      phase: "target",
      context: patchContext,
      patches: [...adapter.patches, ...(registry.target as ReadonlyArray<Patch<unknown>>)],
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
        const events = compiled.adapter.parse(response).pipe(
          Stream.flatMap((chunk) =>
            compiled.adapter.raise(chunk, {
              request: compiled.request,
              patchTrace: compiled.patchTrace,
            }),
          ),
        )
        if (streamPlan.patches.length === 0) return events
        return events.pipe(Stream.map(streamPlan.apply))
      }),
    )

  const generate = Effect.fn("LLM.generate")(function* (request: LLMRequest) {
    const events = Array.from(yield* stream(request).pipe(Stream.runCollect))
    const usage = events.reduce<LLMResponse["usage"]>(
      (last, event) => ("usage" in event && event.usage !== undefined ? event.usage : last),
      undefined,
    )
    return new LLMResponse({ events, usage })
  })

  return { prepare, stream, generate }
}

export * as Adapter from "./adapter"
