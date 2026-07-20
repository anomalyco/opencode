import { Context, Effect, Layer } from "effect"
import { RequestExecutor } from "./route/executor"
import type { ImageRequest, ImageResponse } from "./image"
import type { LLMError } from "./schema"

export type Execute = RequestExecutor.Interface["execute"]

export interface Interface {
  readonly generate: (request: ImageRequest) => Effect.Effect<ImageResponse, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ImageClient") {}

export const generate = (request: ImageRequest): Effect.Effect<ImageResponse, LLMError> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.generate(request)
  }) as Effect.Effect<ImageResponse, LLMError>

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    return Service.of({
      generate: (request) => request.model.route.generate(request, executor.execute),
    })
  }),
)

export const ImageClient = {
  Service,
  layer,
  generate,
} as const
