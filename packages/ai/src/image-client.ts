import { Context, Effect, Layer } from "effect"
import { RequestExecutor } from "./route/executor"
import type { ImageOptions, ImageRequest, ImageRequestFor, ImageResponse } from "./image"
import type { AIError } from "./schema"

export type Execute = RequestExecutor.Interface["execute"]

export interface Interface {
  readonly generate: <Options extends ImageOptions>(
    request: ImageRequestFor<Options>,
  ) => Effect.Effect<ImageResponse, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ImageClient") {}

export const generate = <Options extends ImageOptions>(
  request: ImageRequestFor<Options>,
): Effect.Effect<ImageResponse, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.generate(request)
  })

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
