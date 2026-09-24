import { Context, Effect, Layer, Stream } from "effect"
import { resultEvents, type AwaitOptions, type Generation } from "./generation.js"
import { RequestExecutor } from "./route/executor.js"
import type { AIError } from "./schema/index.js"
import {
  responseEvents,
  type VideoEvent,
  type VideoModel,
  type VideoOptions,
  type VideoRequestFor,
  type VideoResponse,
} from "./video.js"

export interface Interface {
  readonly start: <Options extends VideoOptions>(
    request: VideoRequestFor<Options>,
  ) => Effect.Effect<Generation<VideoResponse>, AIError>
  readonly resume: <Options extends VideoOptions>(
    model: VideoModel<Options>,
    token: unknown,
  ) => Effect.Effect<Generation<VideoResponse>, AIError>
  readonly generate: <Options extends VideoOptions>(
    request: VideoRequestFor<Options>,
    options?: AwaitOptions,
  ) => Effect.Effect<VideoResponse, AIError>
  readonly stream: <Options extends VideoOptions>(
    request: VideoRequestFor<Options>,
    options?: AwaitOptions,
  ) => Stream.Stream<VideoEvent, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/VideoClient") {}

export const start = <Options extends VideoOptions>(
  request: VideoRequestFor<Options>,
): Effect.Effect<Generation<VideoResponse>, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.start(request)
  })

export const resume = <Options extends VideoOptions>(
  model: VideoModel<Options>,
  token: unknown,
): Effect.Effect<Generation<VideoResponse>, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.resume(model, token)
  })

export const generate = <Options extends VideoOptions>(
  request: VideoRequestFor<Options>,
  options?: AwaitOptions,
): Effect.Effect<VideoResponse, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.generate(request, options)
  })

export const stream = <Options extends VideoOptions>(
  request: VideoRequestFor<Options>,
  options?: AwaitOptions,
): Stream.Stream<VideoEvent, AIError, Service> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Service
      return client.stream(request, options)
    }),
  )

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const start = <Options extends VideoOptions>(request: VideoRequestFor<Options>) =>
      request.model.route.start(request, executor.execute)
    return Service.of({
      start,
      resume: (model, token) => model.route.resume(model, token, executor.execute),
      generate: (request, options) => start(request).pipe(Effect.flatMap((generation) => generation.await(options))),
      stream: (request, options) =>
        Stream.unwrap(
          start(request).pipe(Effect.map((generation) => resultEvents(generation, responseEvents, options))),
        ),
    })
  }),
)

export const VideoClient = {
  Service,
  layer,
  start,
  resume,
  generate,
  stream,
} as const
