import { Effect, Schema, Stream } from "effect"
import type { AnyPatch, Patch, PatchRegistry } from "./patch"
import { context, emptyRegistry, plan, registry as makePatchRegistry } from "./patch"
import { ProviderShared } from "./provider/shared"
import {
  InvalidRequestError,
  LLMRequest,
  type LLMError,
  type LLMEvent,
  type ModelRef,
  type PatchTrace,
} from "./schema"

export interface PatchedRequest {
  readonly request: LLMRequest
  readonly trace: ReadonlyArray<PatchTrace>
}

export interface PatchTargetInput<Target> {
  readonly state: PatchedRequest
  readonly target: Target
  readonly adapterPatches: ReadonlyArray<Patch<Target>>
  readonly schema: Schema.Codec<Target, unknown>
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

const normalizeRegistry = (patches: PatchRegistry | ReadonlyArray<AnyPatch> | undefined): PatchRegistry => {
  if (!patches) return emptyRegistry
  if ("request" in patches) return patches
  return makePatchRegistry(patches)
}

const ensureSameRoute = (original: ModelRef, next: ModelRef) =>
  Effect.gen(function* () {
    if (next.provider === original.provider && next.id === original.id && next.protocol === original.protocol) return
    return yield* new InvalidRequestError({
      message: `Patches cannot change model routing (${original.provider}/${original.id}/${original.protocol} -> ${next.provider}/${next.id}/${next.protocol})`,
    })
  })

export const make = (patches?: PatchRegistry | ReadonlyArray<AnyPatch>): PatchPipeline => {
  const registry = normalizeRegistry(patches)

  const patchRequest = Effect.fn("PatchPipeline.patchRequest")(function* (request: LLMRequest) {
    const requestPlan = plan({ phase: "request", context: context({ request }), patches: registry.request })
    const requestAfterRequestPatches = requestPlan.apply(request)
    yield* ensureSameRoute(request.model, requestAfterRequestPatches.model)

    const promptPlan = plan({
      phase: "prompt",
      context: context({ request: requestAfterRequestPatches }),
      patches: registry.prompt,
    })
    const requestBeforeToolPatches = promptPlan.apply(requestAfterRequestPatches)
    yield* ensureSameRoute(request.model, requestBeforeToolPatches.model)

    const toolSchemaPlan = requestBeforeToolPatches.tools.length === 0
      ? undefined
      : plan({ phase: "tool-schema", context: context({ request: requestBeforeToolPatches }), patches: registry.toolSchema })
    const hasToolSchemaPatches = toolSchemaPlan !== undefined && toolSchemaPlan.patches.length > 0
    const patchedRequest = hasToolSchemaPatches
      ? new LLMRequest({
          ...requestBeforeToolPatches,
          tools: requestBeforeToolPatches.tools.map(toolSchemaPlan.apply),
        })
      : requestBeforeToolPatches

    return {
      request: patchedRequest,
      trace: [
        ...requestPlan.trace,
        ...promptPlan.trace,
        ...(hasToolSchemaPatches ? toolSchemaPlan.trace : []),
      ],
    }
  })

  const patchTarget = Effect.fn("PatchPipeline.patchTarget")(function* <Target>(input: PatchTargetInput<Target>) {
    const targetPlan = plan({
      phase: "target",
      context: context({ request: input.state.request }),
      patches: [...input.adapterPatches, ...(registry.target as ReadonlyArray<Patch<Target>>)],
    })
    const target = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(input.schema))(
      targetPlan.apply(input.target),
    )
    return {
      request: input.state.request,
      target,
      trace: [...input.state.trace, ...targetPlan.trace],
    }
  })

  const patchStreamEvents = (input: PatchStreamInput) => {
    const streamPlan = plan({ phase: "stream", context: context({ request: input.request }), patches: registry.stream })
    if (streamPlan.patches.length === 0) return input.events
    return input.events.pipe(Stream.map(streamPlan.apply))
  }

  return { patchRequest, patchTarget, patchStreamEvents }
}

export * as PatchPipeline from "./patch-pipeline"
