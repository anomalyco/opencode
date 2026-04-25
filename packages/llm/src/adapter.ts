import { Effect, Stream } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import type { AnyPatch, Patch, PatchInput, PatchRegistry } from "./patch"
import { context, emptyRegistry, plan, registry as makePatchRegistry, target as targetPatch } from "./patch"
import type { TargetBuilder } from "./target"
import { Transport } from "./transport"
import type {
  LLMError,
  LLMEvent,
  LLMRequest,
  ModelRef,
  PatchTrace,
  PreparedRequest,
  Protocol,
  TransportRequest,
} from "./schema"
import { LLMResponse, NoAdapterError, PreparedRequest as PreparedRequestSchema } from "./schema"

interface Compiled<Target> {
  readonly request: LLMRequest
  readonly target: Target
  readonly transport: TransportRequest
  readonly patchTrace: ReadonlyArray<PatchTrace>
}

export interface TransportContext {
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
  readonly builder: TargetBuilder<Draft, Target>
  readonly patches: ReadonlyArray<Patch<Draft>>
  readonly redact: (target: Target) => unknown
  readonly prepare: (request: LLMRequest) => Effect.Effect<Draft, LLMError>
  readonly toTransport: (target: Target, context: TransportContext) => Effect.Effect<TransportRequest, LLMError>
  readonly parse: (response: HttpClientResponse.HttpClientResponse) => Stream.Stream<Chunk, LLMError>
  readonly raise: (chunk: Chunk, state: RaiseState) => Stream.Stream<LLMEvent, LLMError>
}

export interface AdapterInput<Draft, Target, Chunk> {
  readonly id: string
  readonly protocol: Protocol
  readonly builder: TargetBuilder<Draft, Target>
  readonly patches?: ReadonlyArray<Patch<Draft>>
  readonly redact: (target: Target) => unknown
  readonly prepare: (request: LLMRequest) => Effect.Effect<Draft, LLMError>
  readonly toTransport: (target: Target, context: TransportContext) => Effect.Effect<TransportRequest, LLMError>
  readonly parse: (response: HttpClientResponse.HttpClientResponse) => Stream.Stream<Chunk, LLMError>
  readonly raise: (chunk: Chunk, state: RaiseState) => Stream.Stream<LLMEvent, LLMError>
}

export interface AdapterDefinition<Draft, Target, Chunk> extends Adapter<Draft, Target, Chunk> {
  readonly patch: (id: string, input: PatchInput<Draft>) => Patch<Draft>
  readonly withPatches: (patches: ReadonlyArray<Patch<Draft>>) => AdapterDefinition<Draft, Target, Chunk>
}

export interface LLMClient {
  readonly prepare: (request: LLMRequest) => Effect.Effect<PreparedRequest, LLMError>
  readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError, Transport.Service>
  readonly generate: (request: LLMRequest) => Effect.Effect<LLMResponse, LLMError, Transport.Service>
}

export interface ClientOptions<Draft, Target, Chunk> {
  readonly adapter: Adapter<Draft, Target, Chunk>
  readonly patches?: PatchRegistry | ReadonlyArray<AnyPatch>
  readonly small?: boolean
  readonly flags?: Record<string, string | number | boolean | undefined>
}

const assertProtocol = (model: ModelRef, adapter: { readonly protocol: Protocol }) => {
  if (model.protocol === adapter.protocol) return Effect.void
  return Effect.fail(new NoAdapterError({ protocol: model.protocol, provider: model.provider, model: model.id }))
}

const normalizeRegistry = (patches: PatchRegistry | ReadonlyArray<AnyPatch> | undefined): PatchRegistry => {
  if (!patches) return emptyRegistry
  if ("request" in patches) return patches
  return makePatchRegistry(patches)
}

export function define<Draft, Target, Chunk>(input: AdapterInput<Draft, Target, Chunk>): AdapterDefinition<Draft, Target, Chunk> {
  const build = (patches: ReadonlyArray<Patch<Draft>>): AdapterDefinition<Draft, Target, Chunk> => ({
    id: input.id,
    protocol: input.protocol,
    builder: input.builder,
    patches,
    redact: input.redact,
    prepare: input.prepare,
    toTransport: input.toTransport,
    parse: input.parse,
    raise: input.raise,
    patch: (id, patchInput) => targetPatch(`${input.id}.${id}`, patchInput),
    withPatches: (next) => build([...patches, ...next]),
  })

  return build(input.patches ?? [])
}

export function client<Draft, Target, Chunk>(options: ClientOptions<Draft, Target, Chunk>): LLMClient {
  const registry = normalizeRegistry(options.patches)

  const compile = Effect.fn("LLM.compile")(function* (request: LLMRequest) {
    yield* assertProtocol(request.model, options.adapter)

    const requestPlan = plan({
      phase: "request",
      context: context({ request, small: options.small, flags: options.flags }),
      patches: registry.request,
    })
    const requestAfterRequestPatches = requestPlan.apply(request)
    const promptPlan = plan({
      phase: "prompt",
      context: context({ request: requestAfterRequestPatches, small: options.small, flags: options.flags }),
      patches: registry.prompt,
    })
    const requestBeforeToolPatches = promptPlan.apply(requestAfterRequestPatches)
    const toolSchemaPlan = plan({
      phase: "tool-schema",
      context: context({ request: requestBeforeToolPatches, small: options.small, flags: options.flags }),
      patches: registry.toolSchema,
    })
    const patchedRequest =
      requestBeforeToolPatches.tools.length === 0
        ? requestBeforeToolPatches
        : { ...requestBeforeToolPatches, tools: requestBeforeToolPatches.tools.map(toolSchemaPlan.apply) }
    const patchContext = context({ request: patchedRequest, small: options.small, flags: options.flags })
    const draft = yield* options.adapter.prepare(patchedRequest)
    const targetPlan = plan({
      phase: "target",
      context: patchContext,
      patches: [...options.adapter.patches, ...(registry.target as ReadonlyArray<Patch<Draft>>)],
    })
    const target = yield* options.adapter.builder.validate(targetPlan.apply(draft))
    const targetPatchTrace = [
      ...requestPlan.trace,
      ...promptPlan.trace,
      ...(requestBeforeToolPatches.tools.length === 0 ? [] : toolSchemaPlan.trace),
      ...targetPlan.trace,
    ]
    const rawTransport = yield* options.adapter.toTransport(target, { request: patchedRequest, patchTrace: targetPatchTrace })
    const transportPlan = plan({
      phase: "transport",
      context: patchContext,
      patches: registry.transport,
    })
    const patchTrace = [...targetPatchTrace, ...transportPlan.trace]
    const transport = transportPlan.apply(rawTransport)

    return { request: patchedRequest, target, transport, patchTrace }
  })

  const prepare = Effect.fn("LLM.prepare")(function* (request: LLMRequest) {
    const compiled = yield* compile(request)

    return new PreparedRequestSchema({
      id: compiled.request.id ?? "request",
      adapter: options.adapter.id,
      model: compiled.request.model,
      target: compiled.target,
      redactedTarget: options.adapter.redact(compiled.target),
      transport: compiled.transport,
      patchTrace: compiled.patchTrace,
    })
  })

  const stream = (request: LLMRequest) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const compiled = yield* compile(request)
        const transport = yield* Transport.Service
        const response = yield* transport.fetch(compiled.transport)
        const streamPlan = plan({
          phase: "stream",
          context: context({ request: compiled.request, small: options.small, flags: options.flags }),
          patches: registry.stream,
        })
        const events = options.adapter.parse(response).pipe(
          Stream.flatMap((chunk) =>
            options.adapter.raise(chunk, {
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
