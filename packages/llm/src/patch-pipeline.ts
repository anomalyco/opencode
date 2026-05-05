import { Effect, Stream } from "effect"
import type { AnyPatch, Patch, PatchRegistry } from "./patch"
import { context, emptyRegistry, registry as makePatchRegistry } from "./patch"
import {
  InvalidRequestError,
  LLMRequest,
  type LLMError,
  type LLMEvent,
  type ModelRef,
  type PatchPhase,
  PatchTrace,
  type ToolDefinition,
} from "./schema"

export interface PatchedRequest {
  readonly original: LLMRequest
  readonly request: LLMRequest
  readonly trace: ReadonlyArray<PatchTrace>
}

export interface PatchTargetInput<Target> {
  readonly state: PatchedRequest
  readonly target: Target
  readonly adapterPatches: ReadonlyArray<Patch<Target>>
  readonly validateTarget: (target: Target) => Effect.Effect<Target, LLMError>
}

export interface PatchedTarget<Target> {
  readonly request: LLMRequest
  readonly target: Target
  readonly trace: ReadonlyArray<PatchTrace>
}

export interface PatchStreamInput {
  readonly request: LLMRequest
  readonly events: Stream.Stream<LLMEvent, LLMError>
}

export interface PatchPipeline {
  readonly patchRequest: (request: LLMRequest) => Effect.Effect<PatchedRequest, LLMError>
  readonly patchTarget: <Target>(input: PatchTargetInput<Target>) => Effect.Effect<PatchedTarget<Target>, LLMError>
  readonly patchStreamEvents: (input: PatchStreamInput) => Stream.Stream<LLMEvent, LLMError>
}

const sort = <A>(patches: ReadonlyArray<Patch<A>>) =>
  patches.toSorted((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))

const normalizeRegistry = (patches: PatchRegistry | ReadonlyArray<AnyPatch> | undefined): PatchRegistry => {
  if (!patches) return emptyRegistry
  if ("request" in patches) return patches
  return makePatchRegistry(patches)
}

const sortedRegistry = (patches: PatchRegistry | ReadonlyArray<AnyPatch> | undefined): PatchRegistry => {
  const normalized = normalizeRegistry(patches)
  return {
    request: sort(normalized.request),
    prompt: sort(normalized.prompt),
    toolSchema: sort(normalized.toolSchema),
    target: sort(normalized.target),
    stream: sort(normalized.stream),
  }
}

const select = <A>(phase: PatchPhase, patches: ReadonlyArray<Patch<A>>, ctx: ReturnType<typeof context>) => {
  const selected = patches.filter((patch) => patch.phase === phase && patch.when(ctx))
  return {
    patches: selected,
    trace: selected.map((patch) => new PatchTrace({ id: patch.id, phase: patch.phase, reason: patch.reason })),
    apply: (value: A) => selected.reduce((next, patch) => patch.apply(next, ctx), value),
  }
}

const ensureSameRoute = (original: ModelRef, next: ModelRef) =>
  Effect.gen(function* () {
    if (next.provider === original.provider && next.id === original.id && next.protocol === original.protocol) return
    return yield* new InvalidRequestError({
      message: `Patches cannot change model routing (${original.provider}/${original.id}/${original.protocol} -> ${next.provider}/${next.id}/${next.protocol})`,
    })
  })

export const make = (patches?: PatchRegistry | ReadonlyArray<AnyPatch>): PatchPipeline => {
  const registry = sortedRegistry(patches)

  const patchRequest = Effect.fn("PatchPipeline.patchRequest")(function* (request: LLMRequest) {
    const requestPlan = select("request", registry.request, context({ request }))
    const requestAfterRequestPatches = requestPlan.apply(request)
    yield* ensureSameRoute(request.model, requestAfterRequestPatches.model)

    const promptPlan = select("prompt", registry.prompt, context({ request: requestAfterRequestPatches }))
    const requestBeforeToolPatches = promptPlan.apply(requestAfterRequestPatches)
    yield* ensureSameRoute(request.model, requestBeforeToolPatches.model)

    const toolSchemaPlan = select("tool-schema", registry.toolSchema, context({ request: requestBeforeToolPatches }))
    const hasToolSchemaPatches = requestBeforeToolPatches.tools.length > 0 && toolSchemaPlan.patches.length > 0
    const patchedRequest = hasToolSchemaPatches
      ? new LLMRequest({
          ...requestBeforeToolPatches,
          tools: requestBeforeToolPatches.tools.map(toolSchemaPlan.apply),
        })
      : requestBeforeToolPatches

    return {
      original: request,
      request: patchedRequest,
      trace: [
        ...requestPlan.trace,
        ...promptPlan.trace,
        ...(hasToolSchemaPatches ? toolSchemaPlan.trace : []),
      ],
    }
  })

  const patchTarget = Effect.fn("PatchPipeline.patchTarget")(function* <Target>(input: PatchTargetInput<Target>) {
    const targetPlan = select("target", [
      ...input.adapterPatches,
      ...(registry.target as ReadonlyArray<Patch<Target>>),
    ], context({ request: input.state.request }))
    const target = yield* input.validateTarget(targetPlan.apply(input.target))
    return {
      request: input.state.request,
      target,
      trace: [...input.state.trace, ...targetPlan.trace],
    }
  })

  const patchStreamEvents = (input: PatchStreamInput) => {
    const streamPlan = select("stream", registry.stream, context({ request: input.request }))
    if (streamPlan.patches.length === 0) return input.events
    return input.events.pipe(Stream.map(streamPlan.apply))
  }

  return { patchRequest, patchTarget, patchStreamEvents }
}

export * as PatchPipeline from "./patch-pipeline"
