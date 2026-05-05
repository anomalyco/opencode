import { Effect, Schema, Stream } from "effect"
import type { AnyRuntimeTransform, Transform, TransformRegistry } from "./transform"
import { context, emptyRegistry, plan, registry as makeTransformRegistry } from "./transform"
import * as ProviderShared from "./protocols/shared"
import {
  InvalidRequestError,
  LLMRequest,
  type LLMError,
  type LLMEvent,
  type ModelRef,
} from "./schema"

export interface TransformedRequest {
  readonly request: LLMRequest
}

export interface TransformPayloadInput<Payload> {
  readonly state: TransformedRequest
  readonly payload: Payload
  readonly adapterTransforms: ReadonlyArray<Transform<Payload, "payload">>
  readonly schema: Schema.Codec<Payload, unknown>
}

export interface TransformedPayload<Payload> {
  readonly request: LLMRequest
  readonly payload: Payload
}

export interface TransformStreamInput {
  readonly request: LLMRequest
  readonly events: Stream.Stream<LLMEvent, LLMError>
}

export interface TransformPipeline {
  readonly transformRequest: (request: LLMRequest) => Effect.Effect<TransformedRequest, LLMError>
  readonly transformPayload: <Payload>(input: TransformPayloadInput<Payload>) => Effect.Effect<TransformedPayload<Payload>, LLMError>
  readonly transformStreamEvents: (input: TransformStreamInput) => Stream.Stream<LLMEvent, LLMError>
}

const normalizeRegistry = (transforms: TransformRegistry | ReadonlyArray<AnyRuntimeTransform> | undefined): TransformRegistry => {
  if (!transforms) return emptyRegistry
  if ("request" in transforms) return transforms
  return makeTransformRegistry(transforms)
}

const ensureSameRoute = (original: ModelRef, next: ModelRef) =>
  Effect.gen(function* () {
    if (
      next.provider === original.provider &&
      next.id === original.id &&
      next.adapter === original.adapter &&
      next.protocol === original.protocol
    ) return
    return yield* new InvalidRequestError({
      message: `Transforms cannot change model routing (${original.provider}/${original.id}/${original.adapter}/${original.protocol} -> ${next.provider}/${next.id}/${next.adapter}/${next.protocol})`,
    })
  })

export const make = (transforms?: TransformRegistry | ReadonlyArray<AnyRuntimeTransform>): TransformPipeline => {
  const registry = normalizeRegistry(transforms)

  const transformRequest = Effect.fn("TransformPipeline.transformRequest")(function* (request: LLMRequest) {
    const requestPlan = plan({ phase: "request", context: context({ request }), transforms: registry.request })
    const requestAfterRequestTransforms = requestPlan.apply(request)
    yield* ensureSameRoute(request.model, requestAfterRequestTransforms.model)

    const promptPlan = plan({
      phase: "prompt",
      context: context({ request: requestAfterRequestTransforms }),
      transforms: registry.prompt,
    })
    const requestBeforeToolTransforms = promptPlan.apply(requestAfterRequestTransforms)
    yield* ensureSameRoute(request.model, requestBeforeToolTransforms.model)

    const toolSchemaPlan = requestBeforeToolTransforms.tools.length === 0
      ? undefined
      : plan({ phase: "tool-schema", context: context({ request: requestBeforeToolTransforms }), transforms: registry.toolSchema })
    const hasToolSchemaTransforms = toolSchemaPlan !== undefined && toolSchemaPlan.transforms.length > 0
    const transformedRequest = hasToolSchemaTransforms
      ? new LLMRequest({
          ...requestBeforeToolTransforms,
          tools: requestBeforeToolTransforms.tools.map(toolSchemaPlan.apply),
        })
      : requestBeforeToolTransforms

    return {
      request: transformedRequest,
    }
  })

  const transformPayload = Effect.fn("TransformPipeline.transformPayload")(function* <Payload>(input: TransformPayloadInput<Payload>) {
    const payloadPlan = plan({
      phase: "payload",
      context: context({ request: input.state.request }),
      transforms: input.adapterTransforms,
    })
    const payload = yield* ProviderShared.validateWith(Schema.decodeUnknownEffect(input.schema))(
      payloadPlan.apply(input.payload),
    )
    return {
      request: input.state.request,
      payload,
    }
  })

  const transformStreamEvents = (input: TransformStreamInput) => {
    const streamPlan = plan({ phase: "stream", context: context({ request: input.request }), transforms: registry.stream })
    if (streamPlan.transforms.length === 0) return input.events
    return input.events.pipe(Stream.map(streamPlan.apply))
  }

  return { transformRequest, transformPayload, transformStreamEvents }
}

export * as TransformPipeline from "./transform-pipeline"
