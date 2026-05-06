import { Effect, Layer, Stream } from "effect"
import { LLMClient, RequestExecutor } from "../../src/adapter"
import type { LLMRequest } from "../../src/schema"

export const prepare = <Payload = unknown>(request: LLMRequest) =>
  Effect.gen(function* () {
    return yield* (yield* LLMClient.Service).prepare<Payload>(request)
  }).pipe(Effect.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.defaultLayer))))

export const generate = (request: LLMRequest) =>
  Effect.gen(function* () {
    return yield* (yield* LLMClient.Service).generate(request)
  })

export const stream = (request: LLMRequest) =>
  Stream.unwrap(Effect.gen(function* () {
    return (yield* LLMClient.Service).stream(request)
  }))
