export * as TestLLM from "./testing.js"

import { LLMClient } from "./route/client.js"
import {
  LLMEvent,
  LLMResponse,
  CompactionResponse,
  type FinishReasonDetails,
  type AIError,
  type LLMRequest,
  type ProviderMetadata,
  type UsageInput,
} from "./schema/index.js"
import { Context, Deferred, Effect, Latch, Layer, Queue, Scope, Stream } from "effect"

export type Response = readonly LLMEvent[] | Stream.Stream<LLMEvent, AIError> | CompactionResponse

export type Gate = Readonly<{ started: Effect.Effect<void>; release: Effect.Effect<void> }>

type ClientInterface = Context.Service.Shape<typeof LLMClient.Service>

export type Responder = (request: LLMRequest) => Response

export interface TestInterface extends ClientInterface {
  /** Returns a snapshot of requests observed at execution time. */
  readonly requests: () => Effect.Effect<readonly LLMRequest[]>
  readonly push: (...responses: readonly Response[]) => Effect.Effect<void>
  /** Replaces the fallback without changing queued responses. */
  readonly always: (response: Response) => Effect.Effect<void>
  /** Answers requests after the one-shot queue is exhausted; receives the original request. */
  readonly serve: (responder: Responder) => Effect.Effect<void>
  /** Waits for request arrivals, not output or completion. */
  readonly wait: (count: number) => Effect.Effect<void>
  readonly gate: () => Effect.Effect<Gate, never, Scope.Scope>
}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/ai/TestLLM/Test") {}

/** @deprecated Use TestInterface through Test and testLayer. */
export interface Interface {
  readonly requests: LLMRequest[]
  readonly push: (...responses: readonly Response[]) => Effect.Effect<void>
  readonly always: (response: Response) => Effect.Effect<void>
  readonly wait: (count: number) => Effect.Effect<void>
  readonly gate: Effect.Effect<Gate, never, Scope.Scope>
  readonly client: ClientInterface
}

export interface LayerOptions {
  readonly transformRequest?: (request: LLMRequest) => LLMRequest
  /** Used after the one-shot response queue is exhausted. Omit to defect on unexpected requests. */
  readonly fallback?: Response
}

/** @deprecated Use Test and testLayer for normal client methods and test controls. */
export class Service extends Context.Service<Service, Interface>()("@opencode/ai/TestLLM") {}

export const complete = (
  options: {
    readonly reason: FinishReasonDetails
    readonly usage?: UsageInput
    readonly providerMetadata?: ProviderMetadata
  },
  ...events: readonly LLMEvent[]
) => [
  LLMEvent.stepStart({ index: 0 }),
  ...events,
  LLMEvent.stepFinish({
    index: 0,
    reason: options.reason,
    usage: options.usage,
    providerMetadata: options.providerMetadata,
  }),
  LLMEvent.finish({ reason: options.reason, providerMetadata: options.providerMetadata }),
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

export const failAfter = (error: AIError, ...events: readonly LLMEvent[]) =>
  Stream.fromIterable(events).pipe(Stream.concat(Stream.fail(error)))

export const hangAfter = (...events: readonly LLMEvent[]) => Stream.concat(Stream.fromIterable(events), Stream.never)

const make = (options: LayerOptions) =>
  Effect.sync(() => {
    const requests: LLMRequest[] = []
    const responses: Response[] = []
    let started = Deferred.makeUnsafe<void>()
    let fallback: Response | Responder | undefined = options.fallback
    let activeGate: { readonly started: Queue.Queue<void>; readonly release: Latch.Latch } | undefined
    const wait = (count: number): Effect.Effect<void> =>
      Effect.suspend(() =>
        requests.length >= count ? Effect.void : Deferred.await(started).pipe(Effect.andThen(wait(count))),
      )

    const take = (request: LLMRequest) =>
      Effect.suspend(() => {
        const count = requests.push(options.transformRequest?.(request) ?? request)
        const waiting = started
        started = Deferred.makeUnsafe()
        const gate = activeGate
        try {
          const response = responses.shift() ?? (typeof fallback === "function" ? fallback(request) : fallback)
          if (!response) return Effect.die(new Error(`TestLLM has no response for request ${count}`))
          if (!gate) return Effect.succeed(response)
          return Queue.offer(gate.started, undefined).pipe(Effect.andThen(gate.release.await), Effect.as(response))
        } finally {
          // Waiters can resume synchronously; assign the reply and gate before notifying them.
          Deferred.doneUnsafe(waiting, Effect.void)
        }
      })
    const stream: ClientInterface["stream"] = (request) =>
      Stream.unwrap(
        take(request).pipe(
          Effect.map((response) => {
            if (response instanceof CompactionResponse)
              return Stream.die("TestLLM generation requires an event response")
            return Stream.isStream(response) ? response : Stream.fromIterable(response)
          }),
        ),
      )
    const test = Test.of({
      compact: (request) =>
        take(request).pipe(
          Effect.flatMap((response) =>
            response instanceof CompactionResponse
              ? Effect.succeed(response)
              : Effect.die("TestLLM compaction requires a CompactionResponse"),
          ),
        ),
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
      requests: () => Effect.sync(() => [...requests]),
      push: (...input) =>
        Effect.sync(() => {
          responses.push(...input)
        }),
      always: (response) =>
        Effect.sync(() => {
          fallback = response
        }),
      serve: (responder) =>
        Effect.sync(() => {
          fallback = responder
        }),
      wait,
      gate: () =>
        Effect.gen(function* () {
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
    })

    return { test, requests }
  })

/** Provides one shared implementation under the normal client and test-control tags. */
export const testLayer = (options: LayerOptions = {}) =>
  Layer.effectContext(
    Effect.map(make(options), (implementation) =>
      Context.make(LLMClient.Service, implementation.test).pipe(Context.add(Test, implementation.test)),
    ),
  )

/** @deprecated Use testLayer; retained for published callers of the legacy control interface. */
export const layer = (options: LayerOptions = {}) =>
  Layer.effect(
    Service,
    Effect.map(make(options), (implementation) =>
      Service.of({
        requests: implementation.requests,
        push: implementation.test.push,
        always: implementation.test.always,
        wait: implementation.test.wait,
        gate: implementation.test.gate(),
        client: implementation.test,
      }),
    ),
  )

/** @deprecated testLayer provides LLMClient.Service directly. */
export const clientLayer = Layer.effect(
  LLMClient.Service,
  Effect.map(Service, (service) => service.client),
)

export const push = (...responses: readonly Response[]) => Service.use((service) => service.push(...responses))

export const always = (response: Response) => Service.use((service) => service.always(response))

export const wait = (count: number) => Service.use((service) => service.wait(count))

export const gate = Service.use((service) => service.gate)
