import { Effect, Stream } from "effect"
import { LLMClient } from "../../src/route"
import {
  LLMEvent,
  LLMRequest,
  Message,
  type ContentPart,
  type ProviderMetadata,
  type ToolCallPart,
  ToolResultPart,
  type ToolResultValue,
  type Usage,
} from "../../src/schema"
import { type Tools, toDefinitions } from "../../src/tool"
import { ToolRuntime } from "../../src/tool-runtime"

interface RunOptions<T extends Tools> {
  readonly request: LLMRequest
  readonly tools: T
  readonly maxSteps?: number
}

/** Test-owned continuation loop. Production callers must own durable history. */
export const runTools = <T extends Tools>(options: RunOptions<T>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const names = new Set(Object.keys(options.tools))
      let request = LLMRequest.update(options.request, {
        tools: [...options.request.tools.filter((tool) => !names.has(tool.name)), ...toDefinitions(options.tools)],
      })
      let usage: Usage | undefined
      const events: LLMEvent[] = []

      for (let step = 0; step < (options.maxSteps ?? 10); step++) {
        const streamed = Array.from(yield* LLMClient.stream(request).pipe(Stream.runCollect))
        const state = stepState(streamed)
        usage = addUsage(usage, state.usage)
        events.push(...streamed.filter((event) => event.type !== "finish").map((event) => indexStep(event, step)))

        if (state.toolCalls.length === 0) {
          events.push(LLMEvent.finish({ reason: state.reason, usage, providerMetadata: state.providerMetadata }))
          return Stream.fromIterable(events)
        }

        const dispatched = yield* Effect.forEach(
          state.toolCalls,
          (call) => ToolRuntime.dispatch(options.tools, call).pipe(Effect.map((result) => [call, result] as const)),
          { concurrency: 10 },
        )
        events.push(...dispatched.flatMap(([, result]) => result.events))

        if (step + 1 >= (options.maxSteps ?? 10)) {
          events.push(LLMEvent.finish({ reason: state.reason, usage, providerMetadata: state.providerMetadata }))
          return Stream.fromIterable(events)
        }

        request = LLMRequest.update(request, {
          messages: [
            ...request.messages,
            Message.assistant(state.assistantContent),
            ...dispatched.map(([call, dispatched]) =>
              Message.tool({ id: call.id, name: call.name, result: dispatched.result }),
            ),
          ],
        })
      }

      return Stream.fromIterable(events)
    }),
  )

const indexStep = (event: LLMEvent, index: number): LLMEvent => {
  if (event.type === "step-start") return LLMEvent.stepStart({ index })
  if (event.type === "step-finish") return LLMEvent.stepFinish({ ...event, index })
  return event
}

const stepState = (events: ReadonlyArray<LLMEvent>) => {
  const assistantContent: ContentPart[] = []
  const toolCalls: ToolCallPart[] = []
  let reason: Extract<LLMEvent, { type: "finish" }>["reason"] = "unknown"
  let usage: Usage | undefined
  let providerMetadata: ProviderMetadata | undefined

  for (const event of events) {
    if (event.type === "text-delta" || event.type === "reasoning-delta") {
      appendText(assistantContent, event.type === "text-delta" ? "text" : "reasoning", event.text)
    } else if (event.type === "text-end" || event.type === "reasoning-end") {
      appendText(assistantContent, event.type === "text-end" ? "text" : "reasoning", "", event.providerMetadata)
    } else if (event.type === "tool-call") {
      assistantContent.push(event)
      if (!event.providerExecuted) toolCalls.push(event)
    } else if (event.type === "tool-result" && event.providerExecuted && event.result !== undefined) {
      assistantContent.push(
        ToolResultPart.make({
          id: event.id,
          name: event.name,
          result: event.result,
          providerExecuted: true,
          providerMetadata: event.providerMetadata,
        }),
      )
    } else if (event.type === "finish") {
      reason = event.reason
      usage = event.usage
      providerMetadata = event.providerMetadata
    }
  }
  return { assistantContent, toolCalls, reason, usage, providerMetadata }
}

const appendText = (
  content: ContentPart[],
  type: "text" | "reasoning",
  text: string,
  providerMetadata?: ProviderMetadata,
) => {
  const last = content.at(-1)
  if (last?.type === type) {
    content[content.length - 1] = {
      ...last,
      text: `${last.text}${text}`,
      providerMetadata: providerMetadata ?? last.providerMetadata,
    }
    return
  }
  content.push({ type, text, providerMetadata })
}

const addUsage = (left: Usage | undefined, right: Usage | undefined): Usage | undefined => {
  if (!left) return right
  if (!right) return left
  const sum = (key: keyof Usage) =>
    typeof left[key] !== "number" && typeof right[key] !== "number"
      ? undefined
      : ((left[key] as number | undefined) ?? 0) + ((right[key] as number | undefined) ?? 0)
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    nonCachedInputTokens: sum("nonCachedInputTokens"),
    cacheReadInputTokens: sum("cacheReadInputTokens"),
    cacheWriteInputTokens: sum("cacheWriteInputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    totalTokens: sum("totalTokens"),
  } as Usage
}
