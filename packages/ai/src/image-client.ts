import { Context, Effect, Layer, Stream } from "effect"
import type { AwaitOptions, Generation } from "./generation.js"
import { RequestExecutor } from "./route/executor.js"
import { MediaRoute } from "./route/media.js"
import type { AIError } from "./schema/index.js"
import {
  responseEvents,
  type ImageEvent,
  type ImageModel,
  type ImageOptions,
  type ImageRequestFor,
  type ImageResponse,
} from "./image.js"

export interface Interface {
  readonly generate: <Options extends ImageOptions>(
    request: ImageRequestFor<Options>,
    options?: AwaitOptions,
  ) => Effect.Effect<ImageResponse, AIError>
  readonly stream: <Options extends ImageOptions>(
    request: ImageRequestFor<Options>,
    options?: AwaitOptions,
  ) => Stream.Stream<ImageEvent, AIError>
  readonly start: <Options extends ImageOptions>(
    request: ImageRequestFor<Options>,
  ) => Effect.Effect<Generation<ImageResponse>, AIError>
  readonly resume: <Options extends ImageOptions>(
    model: ImageModel<Options>,
    token: unknown,
  ) => Effect.Effect<Generation<ImageResponse>, AIError>
}

export class ImageClientService extends Context.Service<ImageClientService, Interface>()("@opencode/ImageClient") {}
export const Service = ImageClientService
export type Service = ImageClientService

export const generate = <Options extends ImageOptions>(
  request: ImageRequestFor<Options>,
  options?: AwaitOptions,
): Effect.Effect<ImageResponse, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.generate(request, options)
  })

export const stream = <Options extends ImageOptions>(
  request: ImageRequestFor<Options>,
  options?: AwaitOptions,
): Stream.Stream<ImageEvent, AIError, Service> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Service
      return client.stream(request, options)
    }),
  )

export const start = <Options extends ImageOptions>(
  request: ImageRequestFor<Options>,
): Effect.Effect<Generation<ImageResponse>, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.start(request)
  })

export const resume = <Options extends ImageOptions>(
  model: ImageModel<Options>,
  token: unknown,
): Effect.Effect<Generation<ImageResponse>, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.resume(model, token)
  })

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const dispatch = MediaRoute.dispatch<ImageEvent, ImageResponse>({
      modality: "image",
      execute: executor.execute,
      responseEvents,
    })
    return Service.of({
      start: (request) => dispatch.start(request.model.route, request),
      resume: (model, token) => dispatch.resume(model.route, model, token),
      generate: (request, options) => dispatch.generate(request.model.route, request, options),
      stream: (request, options) => dispatch.stream(request.model.route, request, options),
    })
  }),
)

export const ImageClient = {
  Service,
  layer,
  generate,
  stream,
  start,
  resume,
} as const
