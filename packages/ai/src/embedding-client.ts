import { Context, Effect, Layer } from "effect"
import type { EmbeddingModel, EmbeddingOptions, EmbeddingRequest, EmbeddingResponse } from "./embedding.js"
import { RequestExecutor } from "./route/executor.js"
import { AIError, InvalidProviderOutputError } from "./schema/index.js"

export type Execute = RequestExecutor.Interface["execute"]

export interface Interface {
  readonly generate: <Options extends EmbeddingOptions>(
    request: EmbeddingRequest<EmbeddingModel<Options>>,
  ) => Effect.Effect<EmbeddingResponse, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AI/EmbeddingClient") {}

export const generate = <Options extends EmbeddingOptions>(
  request: EmbeddingRequest<EmbeddingModel<Options>>,
): Effect.Effect<EmbeddingResponse, AIError, Service> => Effect.flatMap(Service, (client) => client.generate(request))

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    return Service.of({
      generate: Effect.fnUntraced(function* (request) {
        const route = request.model.route
        const response = yield* route.generate(request, executor.execute)
        if (response.embeddings.length === request.values.length) return response
        return yield* new AIError({
          reason: new InvalidProviderOutputError({
            route: route.id,
            message: `Expected ${request.values.length} embeddings, got ${response.embeddings.length}`,
          }),
        })
      }),
    })
  }),
)
export const fetchLayer = layer.pipe(Layer.provideMerge(RequestExecutor.fetchLayer))

export const EmbeddingClient = {
  Service,
  layer,
  fetchLayer,
  generate,
} as const
