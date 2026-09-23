import { Context, Effect, Layer, Stream } from "effect"
import { resultEvents, type AwaitOptions, type Generation } from "./generation.js"
import { ProviderShared } from "./protocols/shared.js"
import { RequestExecutor } from "./route/executor.js"
import type { AIError } from "./schema/index.js"
import {
  responseEvents,
  type TranscriptionEvent,
  type TranscriptionModel,
  type TranscriptionOptions,
  type TranscriptionRequestFor,
  type TranscriptionResponse,
  type TranscriptionRoute,
} from "./transcription.js"

export interface Interface {
  readonly generate: <Options extends TranscriptionOptions>(
    request: TranscriptionRequestFor<Options>,
    options?: AwaitOptions,
  ) => Effect.Effect<TranscriptionResponse, AIError>
  readonly stream: <Options extends TranscriptionOptions>(
    request: TranscriptionRequestFor<Options>,
    options?: AwaitOptions,
  ) => Stream.Stream<TranscriptionEvent, AIError>
  readonly start: <Options extends TranscriptionOptions>(
    request: TranscriptionRequestFor<Options>,
  ) => Effect.Effect<Generation<TranscriptionResponse>, AIError>
  readonly resume: <Options extends TranscriptionOptions>(
    model: TranscriptionModel<Options>,
    token: unknown,
  ) => Effect.Effect<Generation<TranscriptionResponse>, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TranscriptionClient") {}

export const generate = <Options extends TranscriptionOptions>(
  request: TranscriptionRequestFor<Options>,
  options?: AwaitOptions,
): Effect.Effect<TranscriptionResponse, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.generate(request, options)
  })

export const stream = <Options extends TranscriptionOptions>(
  request: TranscriptionRequestFor<Options>,
  options?: AwaitOptions,
): Stream.Stream<TranscriptionEvent, AIError, Service> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* Service
      return client.stream(request, options)
    }),
  )

export const start = <Options extends TranscriptionOptions>(
  request: TranscriptionRequestFor<Options>,
): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.start(request)
  })

export const resume = <Options extends TranscriptionOptions>(
  model: TranscriptionModel<Options>,
  token: unknown,
): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.resume(model, token)
  })

const notQueued = <Options extends TranscriptionOptions>(route: TranscriptionRoute<Options>, operation: string) =>
  ProviderShared.unsupportedOperation({
    operation: `transcription.${operation}`,
    provider: route.provider,
    route: route.id,
    message: `${route.provider}/${route.id} is not a queued route; use Transcription.generate or Transcription.stream`,
  })

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const start = <Options extends TranscriptionOptions>(request: TranscriptionRequestFor<Options>) => {
      const route = request.model.route
      if (route.kind !== "queued") return Effect.fail(notQueued(route, "start"))
      return route.start(request, executor.execute)
    }
    return Service.of({
      start,
      resume: (model, token) => {
        const route = model.route
        if (route.kind !== "queued") return Effect.fail(notQueued(route, "resume"))
        return route.resume(model, token, executor.execute)
      },
      generate: (request, options) => {
        const route = request.model.route
        if (route.kind !== "queued") return route.generate(request, executor.execute)
        return start(request).pipe(Effect.flatMap((generation) => generation.await(options)))
      },
      stream: (request, options) => {
        const route = request.model.route
        if (route.kind === "stream") return route.stream(request, executor.execute)
        if (route.kind === "queued")
          return Stream.unwrap(
            start(request).pipe(Effect.map((generation) => resultEvents(generation, responseEvents, options))),
          )
        return Stream.fromIterableEffect(Effect.map(route.generate(request, executor.execute), responseEvents))
      },
    })
  }),
)

export const TranscriptionClient = {
  Service,
  layer,
  generate,
  stream,
  start,
  resume,
} as const
