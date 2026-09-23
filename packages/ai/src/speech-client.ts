import { Context, Effect, Layer, Stream } from "effect"
import { RequestExecutor } from "./route/executor.js"
import type { AIError } from "./schema/index.js"
import type { SpeechEvent, SpeechOptions, SpeechRequestFor, SpeechResponse } from "./speech.js"

export interface Interface {
  readonly generate: <Options extends SpeechOptions>(
    request: SpeechRequestFor<Options>,
  ) => Effect.Effect<SpeechResponse, AIError>
  readonly stream: <Options extends SpeechOptions>(
    request: SpeechRequestFor<Options>,
  ) => Stream.Stream<SpeechEvent, AIError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SpeechClient") {}

export const generate = <Options extends SpeechOptions>(
  request: SpeechRequestFor<Options>,
): Effect.Effect<SpeechResponse, AIError, Service> =>
  Effect.gen(function* () {
    const client = yield* Service
    return yield* client.generate(request)
  })

export const stream = <Options extends SpeechOptions>(
  request: SpeechRequestFor<Options>,
): Stream.Stream<SpeechEvent, AIError, Service> =>
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
    return Service.of({
      generate: (request) => request.model.route.generate(request, executor.execute),
      stream: (request) => request.model.route.stream(request, executor.execute),
    })
  }),
)

export const SpeechClient = {
  Service,
  layer,
  generate,
  stream,
} as const
