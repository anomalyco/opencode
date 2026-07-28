export * as TestLLM from "./llm"

import { LLMClient, LLMEvent, type LLMClientShape, type LLMError, type LLMRequest } from "@opencode-ai/ai"
import { Context, Deferred, Effect, Latch, Layer, Queue, Scope, Stream } from "effect"

export type Response = readonly LLMEvent[] | Stream.Stream<LLMEvent, LLMError>

export interface Gate {
  readonly started: Effect.Effect<void>
  readonly release: Effect.Effect<void>
}

export interface Interface {
  readonly requests: LLMRequest[]
  readonly push: (...responses: readonly Response[]) => Effect.Effect<void>
  readonly always: (response: Response) => Effect.Effect<void>
  readonly wait: (count: number) => Effect.Effect<void>
  readonly gate: Effect.Effect<Gate, never, Scope.Scope>
  readonly client: LLMClientShape
}

export class Service extends Context.Service<Service, Interface>()("@test/LLM") {}

export const stop = () => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
  LLMEvent.finish({ reason: { normalized: "stop" } }),
]

export const text = (value: string, id: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text: value }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: { normalized: "stop" } }),
  LLMEvent.finish({ reason: { normalized: "stop" } }),
]

export const textWithUsage = (value: string, id: string, inputTokens: number) =>
  text(value, id).map((event) =>
    LLMEvent.is.stepFinish(event)
      ? LLMEvent.stepFinish({
          index: event.index,
          reason: event.reason,
          usage: { inputTokens, nonCachedInputTokens: inputTokens },
        })
      : event,
  )

export const tool = (id: string, name: string, input: unknown) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.toolCall({ id, name, input }),
  LLMEvent.stepFinish({ index: 0, reason: { normalized: "tool-calls" } }),
  LLMEvent.finish({ reason: { normalized: "tool-calls" } }),
]

const toStream = (response: Response) => (Stream.isStream(response) ? response : Stream.fromIterable(response))

export const layer = (transformRequest: (request: LLMRequest) => LLMRequest = (request) => request) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const requests: LLMRequest[] = []
      const responses: Response[] = []
      const waits: Array<{ readonly count: number; readonly ready: Deferred.Deferred<void> }> = []
      let fallback: Response = []
      let activeGate: { readonly started: Queue.Queue<void>; readonly release: Latch.Latch } | undefined

      const client = LLMClient.Service.of({
        prepare: () => Effect.die("unused"),
        stream: ((request: LLMRequest) => {
          requests.push(transformRequest(request))
          const ready = waits.filter((wait) => requests.length >= wait.count)
          waits.splice(0, waits.length, ...waits.filter((wait) => requests.length < wait.count))
          ready.forEach((wait) => Deferred.doneUnsafe(wait.ready, Effect.void))
          const response = toStream(responses.shift() ?? fallback)
          const gate = activeGate
          if (!gate) return response
          return Stream.unwrap(
            Queue.offer(gate.started, undefined).pipe(Effect.andThen(gate.release.await), Effect.as(response)),
          )
        }) as LLMClientShape["stream"],
        generate: () => Effect.die("unused"),
      })

      return Service.of({
        requests,
        push: (...input) =>
          Effect.sync(() => {
            responses.push(...input)
          }),
        always: (response) =>
          Effect.sync(() => {
            fallback = response
          }),
        wait: (count) =>
          Effect.gen(function* () {
            if (requests.length >= count) return
            const ready = yield* Deferred.make<void>()
            waits.push({ count, ready })
            yield* Deferred.await(ready)
          }),
        gate: Effect.gen(function* () {
          const gate = {
            started: yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown),
            release: yield* Latch.make(),
          }
          activeGate = gate
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (activeGate === gate) activeGate = undefined
            }),
          )
          return {
            started: Queue.take(gate.started),
            release: Effect.sync(() => {
              if (activeGate === gate) activeGate = undefined
            }).pipe(Effect.andThen(gate.release.open), Effect.asVoid),
          }
        }),
        client,
      })
    }),
  )

export const clientLayer = Layer.effect(
  LLMClient.Service,
  Effect.gen(function* () {
    return (yield* Service).client
  }),
)

export const push = (...responses: readonly Response[]) =>
  Effect.gen(function* () {
    const service = yield* Service
    yield* service.push(...responses)
  })

export const always = (response: Response) =>
  Effect.gen(function* () {
    const service = yield* Service
    yield* service.always(response)
  })

export const wait = (count: number) =>
  Effect.gen(function* () {
    const service = yield* Service
    yield* service.wait(count)
  })

export const gate = Effect.gen(function* () {
  const service = yield* Service
  return yield* service.gate
})
