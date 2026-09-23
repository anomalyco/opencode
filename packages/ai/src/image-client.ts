import { Context, Effect, Layer, Stream } from "effect"
import { RequestExecutor } from "./route/executor.js"
import type { AIError } from "./schema/index.js"
import {
  responseEvents,
  type ImageEvent,
  type ImageOptions,
  type ImageRequestFor,
  type ImageResponse,
} from "./image.js"

export interface Interface {
  readonly generate: <Options extends ImageOptions>(
    request: ImageRequestFor<Options>,
  ) => Effect.Effect<ImageResponse, AIError>
  readonly stream: <Options extends ImageOptions>(
    request: ImageRequestFor<Options>,
  ) => Stream.Stream<ImageEvent, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ImageClient") {}

export const generate = <Options extends ImageOptions>(
  request: ImageRequestFor<Options>,
): Effect.Effect<ImageResponse, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.generate(request)
  })

export const stream = <Options extends ImageOptions>(
  request: ImageRequestFor<Options>,
): Stream.Stream<ImageEvent, AIError, Service> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Service
      return client.stream(request)
    }),
  )

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const generate = <Options extends ImageOptions>(request: ImageRequestFor<Options>) =>
      request.model.route.generate(request, executor.execute)
    return Service.of({
      generate,
      // Inline routes have no partial frames yet; the stream is the completed response expanded into events.
      stream: (request) =>
        Stream.fromIterableEffect(Effect.map(generate(request), responseEvents)),
    })
  }),
)

export const ImageClient = {
  Service,
  layer,
  generate,
  stream,
} as const
