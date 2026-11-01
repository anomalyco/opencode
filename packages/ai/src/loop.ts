import { Effect, Stream } from "effect"
import {
  AIError,
  InvalidProviderOutputError,
  LLMResponse,
  Message,
  Usage,
  type Finish,
  type FinishReasonDetails,
  type LLMEvent,
  type LLMRequest,
  type ToolCallPart,
} from "./schema/index.js"
import type { DispatchResult } from "./tool-runtime.js"

/** Client calls to run before the next step. A step that calls `answerTool` is final, even alongside other tools. */
export const pendingCalls = (response: LLMResponse, answerTool?: string): ReadonlyArray<ToolCallPart> =>
  answerTool !== undefined && response.toolCalls.some((call) => call.name === answerTool)
    ? []
    : response.toolCalls.filter((call) => call.providerExecuted !== true)

/** The step's assistant message followed by one tool message per call, in call order. */
export const stepMessages = (
  response: LLMResponse,
  calls: ReadonlyArray<ToolCallPart>,
  results: ReadonlyArray<DispatchResult>,
): ReadonlyArray<Message> => [
  response.message,
  ...calls.map((call, i) =>
    Message.tool({
      id: call.id,
      name: call.name,
      namespace: call.namespace,
      result: results[i].result,
      providerMetadata: call.providerMetadata,
    }),
  ),
]

/** The request for the step after `response`, with its messages and tool results appended. */
export const nextRequest = (
  request: LLMRequest,
  response: LLMResponse,
  calls: ReadonlyArray<ToolCallPart>,
  results: ReadonlyArray<DispatchResult>,
): LLMRequest => ({ ...request, messages: [...request.messages, ...stepMessages(response, calls, results)] })

/** Sum usage across steps. */
export const addUsage = (total: Usage | undefined, step: Usage | undefined) => {
  if (total === undefined || step === undefined) return total ?? step
  const sum = (
    key:
      | "inputTokens"
      | "outputTokens"
      | "nonCachedInputTokens"
      | "cacheReadInputTokens"
      | "cacheWriteInputTokens"
      | "reasoningTokens"
      | "totalTokens"
      | "cost",
  ) => (total[key] === undefined && step[key] === undefined ? undefined : (total[key] ?? 0) + (step[key] ?? 0))
  return new Usage({
    // Context size describes the latest call, not a running total.
    contextTokens: step.contextTokens ?? total.contextTokens,
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    nonCachedInputTokens: sum("nonCachedInputTokens"),
    cacheReadInputTokens: sum("cacheReadInputTokens"),
    cacheWriteInputTokens: sum("cacheWriteInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
    cost: sum("cost"),
  })
}

/** The result of `collect`: every step of a stream from `stream` or `loop`, folded into one value. */
export interface Collected {
  /** Text of the final step. */
  readonly text: string
  /** One response per model call, in order. */
  readonly steps: ReadonlyArray<LLMResponse>
  /** Each step's assistant message followed by its tool results, ready to append to the request's messages. */
  readonly messages: ReadonlyArray<Message>
  /** Usage from the terminal `finish`, summed across steps for a loop. */
  readonly usage?: Usage
  readonly finishReason: FinishReasonDetails
}

type FinishOf<Event> = Extract<Event, { readonly type: "finish" }>

/** `Collected`, plus `object` when the stream was started with `schema`. */
export type CollectResult<Event> = "object" extends keyof FinishOf<Event>
  ? Collected & Pick<FinishOf<Event>, "object">
  : Collected

/** Run a stream from `stream` or `loop` to the end and fold its events into the final result. */
export function collect<Event extends LLMEvent, E, R>(
  events: Stream.Stream<Event, E, R>,
): Effect.Effect<CollectResult<Event>, E | AIError, R>
export function collect<E, R>(
  events: Stream.Stream<LLMEvent, E, R>,
): Effect.Effect<Collected & { readonly object?: unknown }, E | AIError, R> {
  return Effect.suspend(() => {
    const steps: LLMResponse[] = []
    const messages: Message[] = []
    let step = LLMResponse.empty()
    // Between a `step-finish` and the next `step-start`, tool results come from the loop running tools.
    let betweenSteps = false
    let finish: Finish | undefined
    const close = (reason: FinishReasonDetails, usage: Usage | undefined) => {
      if (step.events.length === 0) return
      const response = new LLMResponse({
        message: step.message,
        events: step.events,
        usage: usage ?? step.usage,
        finishReason: reason,
      })
      steps.push(response)
      messages.push(response.message)
      step = LLMResponse.empty()
    }
    return Stream.runForEach(events, (event) =>
      Effect.sync(() => {
        if (event.type === "finish") {
          close(event.reason, event.usage)
          finish = event
          return
        }
        if (event.type === "tool-result" && betweenSteps) {
          messages.push(
            Message.tool({
              id: event.id,
              name: event.name,
              namespace: event.namespace,
              result: event.result,
              providerMetadata: event.providerMetadata,
            }),
          )
          return
        }
        if (event.type === "step-start") betweenSteps = false
        step = LLMResponse.reduce(step, event)
        if (event.type !== "step-finish") return
        close(event.reason, event.usage)
        betweenSteps = true
      }),
    ).pipe(
      Effect.flatMap(() => {
        if (finish === undefined)
          return Effect.fail(
            new AIError({
              reason: new InvalidProviderOutputError({
                message: "The stream ended without a finish event.",
                classification: "incomplete-stream",
              }),
            }),
          )
        const result = {
          text: steps.at(-1)?.text ?? "",
          steps,
          messages,
          usage: finish.usage,
          finishReason: finish.reason,
          ...("object" in finish ? { object: finish.object } : {}),
        }
        return Effect.succeed(result)
      }),
    )
  })
}
