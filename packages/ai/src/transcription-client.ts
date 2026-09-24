import { Context, Effect, Layer, Stream } from "effect"
import type { AwaitOptions, Generation } from "./generation.js"
import { RequestExecutor } from "./route/executor.js"
import { MediaRoute } from "./route/media.js"
import type { AIError } from "./schema/index.js"
import {
  responseEvents,
  type TranscriptionEvent,
  type TranscriptionModel,
  type TranscriptionOptions,
  type TranscriptionRequestFor,
  type TranscriptionResponse,
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

export const layer: Layer.Layer<Service, never, RequestExecutor.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const dispatch = MediaRoute.dispatch<TranscriptionEvent, TranscriptionResponse>({
      modality: "transcription",
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

export const TranscriptionClient = {
  Service,
  layer,
  generate,
  stream,
  start,
  resume,
} as const
