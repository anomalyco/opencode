import { Effect, Stream } from "effect"
import {
  AIError,
  InvalidProviderOutputError,
  LLMResponse,
  Message,
  Usage,
  LLMEvent,
  ToolCallPart,
  ToolChoice,
  type Finish,
  type FinishReasonDetails,
  type LLMRequest,
  type ToolInputError,
} from "./schema/index.js"
import type { DispatchResult, PendingCall } from "./tool-runtime.js"

/**
 * Client calls to answer before the next step. A call whose input was not valid JSON carries the error the model
 * gets back, so it can retry. A step is final when it calls `answerTool`, even alongside other tools, or when it hits
 * the output token limit, which may have cut its calls off.
 */
export const pendingCalls = (response: LLMResponse, answerTool?: string): ReadonlyArray<PendingCall> => {
  if (response.finishReason.normalized === "length") return []
  if (answerTool !== undefined && response.toolCalls.some((call) => call.name === answerTool)) return []
  return [
    ...response.toolCalls.filter((call) => call.providerExecuted !== true).map((call) => ({ call })),
    ...response.events.filter(LLMEvent.is.toolInputError).map((event) => ({
      call: invalidCall(event),
      error: `Invalid tool arguments: the input is not valid JSON. Received: ${event.raw}`,
    })),
  ]
}

/** The call to replay for input that was not valid JSON. Providers require an object input, so it is empty. */
const invalidCall = (event: ToolInputError) =>
  ToolCallPart.make({ id: event.id, name: event.name, namespace: event.namespace, input: {} })

/** Add the replayed calls for invalid input to the assistant message, so each tool result has its call. */
const withInvalidCalls = (message: Message, calls: ReadonlyArray<ToolCallPart>) =>
  calls.length === 0 ? message : new Message({ ...message, content: [...message.content, ...calls] })

/** The step's assistant message followed by one tool message per call, in call order. */
export const stepMessages = (
  response: LLMResponse,
  calls: ReadonlyArray<PendingCall>,
  results: ReadonlyArray<DispatchResult>,
): ReadonlyArray<Message> => [
  withInvalidCalls(
    response.message,
    calls.flatMap((item) => (item.error === undefined ? [] : [item.call])),
  ),
  ...calls.map((item, i) =>
    Message.tool({
      id: item.call.id,
      name: item.call.name,
      namespace: item.call.namespace,
      result: results[i].result,
      providerMetadata: item.call.providerMetadata,
    }),
  ),
]

/**
 * The request for the step after `response`, with its messages and tool results appended. A caller's forced
 * `toolChoice` applies to the first step only; with `keepForcedChoice` (the answer tool's) it stays.
 */
export const nextRequest = (
  request: LLMRequest,
  response: LLMResponse,
  calls: ReadonlyArray<PendingCall>,
  results: ReadonlyArray<DispatchResult>,
  keepForcedChoice: boolean,
): LLMRequest => ({
  ...request,
  toolChoice:
    !keepForcedChoice && (request.toolChoice?.type === "required" || request.toolChoice?.type === "tool")
      ? new ToolChoice({ type: "auto", disableParallelToolUse: request.toolChoice.disableParallelToolUse })
      : request.toolChoice,
  messages: [...request.messages, ...stepMessages(response, calls, results)],
})

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
    // The last step's assistant message, and its calls with invalid input that the loop may answer.
    let assistant = -1
    let invalid: ReadonlyArray<ToolCallPart> = []
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
      assistant = messages.push(response.message) - 1
      invalid = step.events.filter(LLMEvent.is.toolInputError).map(invalidCall)
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
          const call = invalid.find((item) => item.id === event.id)
          if (call) messages[assistant] = withInvalidCalls(messages[assistant], [call])
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
