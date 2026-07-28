export * as TestLLM from "./testing"

import { LLMClient, type Interface as LLMClientShape } from "./route/client"
import {
  LLMEvent,
  LLMResponse,
  type FinishReasonDetails,
  type LLMError,
  type LLMRequest,
  type UsageInput,
} from "./schema"
import { Context, Deferred, Effect, Latch, Layer, Queue, Scope, Stream } from "effect"

export type Response = readonly LLMEvent[] | Stream.Stream<LLMEvent, LLMError>

export type Gate = Readonly<{ started: Effect.Effect<void>; release: Effect.Effect<void> }>

export interface Interface {
  readonly requests: LLMRequest[]
  readonly push: (...responses: readonly Response[]) => Effect.Effect<void>
  readonly always: (response: Response) => Effect.Effect<void>
  readonly wait: (count: number) => Effect.Effect<void>
  readonly gate: Effect.Effect<Gate, never, Scope.Scope>
  readonly client: LLMClientShape
}

export interface LayerOptions {
  readonly transformRequest?: (request: LLMRequest) => LLMRequest
  /** Used after the one-shot response queue is exhausted. Omit to defect on unexpected requests. */
  readonly fallback?: Response
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ai/TestLLM") {}

export const complete = (
  options: { readonly reason: FinishReasonDetails; readonly usage?: UsageInput },
  ...events: readonly LLMEvent[]
) => [
  LLMEvent.stepStart({ index: 0 }),
  ...events,
  LLMEvent.stepFinish({ index: 0, reason: options.reason, usage: options.usage }),
  LLMEvent.finish({ reason: options.reason }),
]

export const stop = (...events: readonly LLMEvent[]) => complete({ reason: { normalized: "stop" } }, ...events)

export const toolCalls = (...events: readonly LLMEvent[]) =>
  complete({ reason: { normalized: "tool-calls" } }, ...events)

const textEvents = (value: string, id: string) => [
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text: value }),
  LLMEvent.textEnd({ id }),
]

export const text = (value: string, id: string) => stop(...textEvents(value, id))

export const textWithUsage = (value: string, id: string, inputTokens: number) =>
  complete(
    { reason: { normalized: "stop" }, usage: { inputTokens, nonCachedInputTokens: inputTokens } },
    ...textEvents(value, id),
  )

export const tool = (id: string, name: string, input: unknown) => toolCalls(LLMEvent.toolCall({ id, name, input }))

export const failAfter = (error: LLMError, ...events: readonly LLMEvent[]) =>
  Stream.fromIterable(events).pipe(Stream.concat(Stream.fail(error)))

export const hangAfter = (...events: readonly LLMEvent[]) => Stream.concat(Stream.fromIterable(events), Stream.never)

const toStream = (response: Response) => (Stream.isStream(response) ? response : Stream.fromIterable(response))

export const layer = (options: LayerOptions = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const requests: LLMRequest[] = []
      const responses: Response[] = []
      let started = Deferred.makeUnsafe<void>()
      let fallback = options.fallback
      let activeGate: { readonly started: Queue.Queue<void>; readonly release: Latch.Latch } | undefined
      const wait = (count: number): Effect.Effect<void> =>
        Effect.suspend(() =>
          requests.length >= count ? Effect.void : Deferred.await(started).pipe(Effect.andThen(wait(count))),
        )

      const stream = ((request: LLMRequest) => {
        requests.push(options.transformRequest?.(request) ?? request)
        const waiting = started
        started = Deferred.makeUnsafe()
        Deferred.doneUnsafe(waiting, Effect.void)
        const response = responses.shift() ?? fallback
        if (!response) return Stream.die(new Error(`TestLLM has no response for request ${requests.length}`))
        const streamed = toStream(response)
        const gate = activeGate
        if (!gate) return streamed
        return Stream.unwrap(
          Queue.offer(gate.started, undefined).pipe(Effect.andThen(gate.release.await), Effect.as(streamed)),
        )
      }) as LLMClientShape["stream"]
      const client = LLMClient.Service.of({
        prepare: () => Effect.die("TestLLM does not prepare provider-native requests"),
        stream,
        generate: (request) =>
          stream(request).pipe(
            Stream.runFold(LLMResponse.empty, LLMResponse.reduce),
            Effect.flatMap((state) => {
              const response = LLMResponse.complete(state)
              if (response) return Effect.succeed(response)
              return Effect.die("TestLLM response ended without a terminal finish event")
            }),
          ),
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
        wait,
        gate: Effect.gen(function* () {
          const gate = {
            started: yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown),
            release: yield* Latch.make(),
          }
          activeGate = gate
          const release = Effect.sync(() => {
            if (activeGate === gate) activeGate = undefined
          }).pipe(Effect.andThen(gate.release.open), Effect.asVoid)
          yield* Effect.addFinalizer(() => release)
          return {
            started: Queue.take(gate.started),
            release,
          }
        }),
        client,
      })
    }),
  )

export const clientLayer = Layer.effect(
  LLMClient.Service,
  Effect.map(Service, (service) => service.client),
)

export const push = (...responses: readonly Response[]) => Service.use((service) => service.push(...responses))

export const always = (response: Response) => Service.use((service) => service.always(response))

export const wait = (count: number) => Service.use((service) => service.wait(count))

export const gate = Service.use((service) => service.gate)
