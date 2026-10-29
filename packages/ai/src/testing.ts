export * as TestLLM from "./testing.js"
export { compileRequest } from "./route/client.js"
export { TestDecision } from "./testing/decision.js"
export { TestImage } from "./testing/image.js"
export { TestSpeech } from "./testing/speech.js"
export { TestTranscription } from "./testing/transcription.js"
export { TestVideo } from "./testing/video.js"

import {
  LLMClient,
  type CompactionRequest,
  type CheckpointRequest,
  type EndpointCompactOptions,
  type TriggerCompactOptions,
} from "./route/client.js"
import {
  LLMEvent,
  LLMResponse,
  CompactionResponse,
  CompactionCheckpointResponse,
  type FinishReasonDetails,
  type AIError,
  type LLMRequest,
  type ProviderMetadata,
  type UsageInput,
} from "./schema/index.js"
import { Context, Effect, Layer, Stream } from "effect"
import { TestScript } from "./testing/script.js"

export type Response =
  | readonly LLMEvent[]
  | Stream.Stream<LLMEvent, AIError>
  | CompactionResponse
  | CompactionCheckpointResponse

export type Gate = TestScript.Gate

type ClientInterface = Context.Service.Shape<typeof LLMClient.Service>

export type Responder = (request: LLMRequest) => Response

export interface TestInterface extends ClientInterface, TestScript.Controls<LLMRequest, Response> {}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/ai/TestLLM/Test") {}

export type LayerOptions = TestScript.Options<LLMRequest, Response>

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
    const script = TestScript.make<LLMRequest, Response>("TestLLM", options)
    const stream: ClientInterface["stream"] = (request) =>
      Stream.unwrap(
        script.take(request).pipe(
          Effect.map((response) => {
            if (response instanceof CompactionResponse || response instanceof CompactionCheckpointResponse)
              return Stream.die("TestLLM generation requires an event response")
            return Stream.isStream(response) ? response : Stream.fromIterable(response)
          }),
        ),
      )
    function compact(
      request: CompactionRequest,
      options?: EndpointCompactOptions,
    ): Effect.Effect<CompactionResponse, AIError>
    function compact(
      request: CheckpointRequest,
      options: TriggerCompactOptions,
    ): Effect.Effect<CompactionCheckpointResponse, AIError>
    function compact(
      request: LLMRequest,
      options?: EndpointCompactOptions | TriggerCompactOptions,
    ): Effect.Effect<CompactionResponse | CompactionCheckpointResponse, AIError> {
      return script.take(request).pipe(
        Effect.flatMap((response): Effect.Effect<CompactionResponse | CompactionCheckpointResponse> => {
          if (options?.mechanism === "trigger")
            return response instanceof CompactionCheckpointResponse
              ? Effect.succeed(response)
              : Effect.die("TestLLM trigger compaction requires a CompactionCheckpointResponse")
          return response instanceof CompactionResponse
            ? Effect.succeed(response)
            : Effect.die("TestLLM compaction requires a CompactionResponse")
        }),
      )
    }
    return Test.of({
      ...script.controls,
      compact,
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
  })

/** Provides one shared implementation under the normal client and test-control tags. */
export const testLayer = (options: LayerOptions = {}) =>
  Layer.effectContext(
    Effect.map(make(options), (test) => Context.make(LLMClient.Service, test).pipe(Context.add(Test, test))),
  )
