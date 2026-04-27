import type { LLMEvent, ToolResultValue, Usage } from "@opencode-ai/llm"
import type { Event as SessionEvent } from "./llm"

type MapperState = {
  readonly text: Set<string>
  readonly reasoning: Set<string>
  readonly toolInput: Set<string>
  readonly toolInputs: Map<string, unknown>
}

const textID = (event: { readonly id?: string }) => event.id ?? "text"

const reasoningID = (event: { readonly id?: string }) => event.id ?? "reasoning"

const usage = (input: Usage | undefined) =>
  ({
    inputTokens: input?.inputTokens ?? 0,
    outputTokens: input?.outputTokens ?? 0,
    totalTokens: input?.totalTokens,
    reasoningTokens: input?.reasoningTokens,
    cachedInputTokens: input?.cacheReadInputTokens,
    inputTokenDetails: {
      noCacheTokens: Math.max(0, (input?.inputTokens ?? 0) - (input?.cacheReadInputTokens ?? 0) - (input?.cacheWriteInputTokens ?? 0)),
      cacheReadTokens: input?.cacheReadInputTokens,
      cacheWriteTokens: input?.cacheWriteInputTokens,
    },
    outputTokenDetails: {
      textTokens: Math.max(0, (input?.outputTokens ?? 0) - (input?.reasoningTokens ?? 0)),
      reasoningTokens: input?.reasoningTokens,
    },
  })

const stringifyResult = (result: ToolResultValue) => {
  if (typeof result.value === "string") return result.value
  return JSON.stringify(result.value)
}

// Recognize the opencode `Tool.ExecuteResult` shape inside a `tool-result`
// event's `result.value`. Native-path tool dispatchers wrap their handler
// output in this shape so the AI-SDK-shaped session event carries the
// real `title`, `metadata`, and `output` fields rather than the JSON
// encoding of the whole record. Provider-executed tools (Anthropic
// `web_search` etc.) and synthetic results that don't follow the shape
// still go through `stringifyResult` below.
type ExecuteShape = {
  readonly title?: unknown
  readonly metadata?: unknown
  readonly output?: unknown
}

const isExecuteResult = (value: unknown): value is ExecuteShape => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const v = value as ExecuteShape
  return typeof v.output === "string"
}

const toolResultOutput = (result: ToolResultValue) => {
  if (result.type !== "json" || !isExecuteResult(result.value)) {
    return { title: "", metadata: {}, output: stringifyResult(result) }
  }
  const value = result.value
  return {
    title: typeof value.title === "string" ? value.title : "",
    metadata: typeof value.metadata === "object" && value.metadata !== null ? (value.metadata as Record<string, unknown>) : {},
    output: typeof value.output === "string" ? value.output : "",
  }
}

const response = () => ({ id: "", timestamp: new Date(0), modelId: "" })

const finishReason = (reason: Extract<LLMEvent, { type: "request-finish" | "step-finish" }>["reason"]) =>
  reason === "unknown" ? "error" : reason

const closeOpenParts = (state: MapperState) => [
  ...Array.from(state.text, (id) => ({ type: "text-end" as const, id })),
  ...Array.from(state.reasoning, (id) => ({ type: "reasoning-end" as const, id })),
  ...Array.from(state.toolInput, (id) => ({ type: "tool-input-end" as const, id })),
]

export const mapper = () => {
  const state: MapperState = { text: new Set(), reasoning: new Set(), toolInput: new Set(), toolInputs: new Map() }

  const startText = (id: string) => {
    if (state.text.has(id)) return []
    state.text.add(id)
    return [{ type: "text-start" as const, id }]
  }

  const endText = (id: string) => {
    if (!state.text.has(id)) return []
    state.text.delete(id)
    return [{ type: "text-end" as const, id }]
  }

  const startReasoning = (id: string) => {
    if (state.reasoning.has(id)) return []
    state.reasoning.add(id)
    return [{ type: "reasoning-start" as const, id }]
  }

  const startToolInput = (id: string, toolName: string, providerExecuted?: boolean) => {
    if (state.toolInput.has(id)) return []
    state.toolInput.add(id)
    return [{ type: "tool-input-start" as const, id, toolName, providerExecuted }]
  }

  const endToolInput = (id: string) => {
    if (!state.toolInput.has(id)) return []
    state.toolInput.delete(id)
    return [{ type: "tool-input-end" as const, id }]
  }

  const finish = (event: Extract<LLMEvent, { type: "request-finish" | "step-finish" }>, includeFinal: boolean) => {
    const reason = finishReason(event.reason)
    const events = [
      ...closeOpenParts(state),
      {
        type: "finish-step" as const,
        finishReason: reason,
        rawFinishReason: event.reason,
        usage: usage(event.usage),
        response: response(),
        providerMetadata: undefined,
      },
      ...(includeFinal
        ? [{ type: "finish" as const, finishReason: reason, rawFinishReason: event.reason, usage: usage(event.usage), totalUsage: usage(event.usage), response: response(), providerMetadata: undefined }]
        : []),
    ]
    state.text.clear()
    state.reasoning.clear()
    state.toolInput.clear()
    return events
  }

  const map = (event: LLMEvent): ReadonlyArray<SessionEvent> => {
    switch (event.type) {
      case "request-start":
        return [{ type: "start" }]
      case "step-start":
        return [{ type: "start-step", request: {}, warnings: [] }]
      case "text-start":
        return startText(event.id)
      case "text-delta": {
        const id = textID(event)
        return [...startText(id), { type: "text-delta", id, text: event.text }]
      }
      case "text-end":
        return endText(event.id)
      case "reasoning-delta": {
        const id = reasoningID(event)
        return [...startReasoning(id), { type: "reasoning-delta", id, text: event.text }]
      }
      case "tool-input-delta":
        return [
          ...startToolInput(event.id, event.name),
          { type: "tool-input-delta", id: event.id, delta: event.text },
        ]
      case "tool-call":
        state.toolInputs.set(event.id, event.input)
        return [
          ...startToolInput(event.id, event.name, event.providerExecuted),
          ...endToolInput(event.id),
          {
            type: "tool-call",
            toolCallId: event.id,
            toolName: event.name,
            input: event.input,
            providerExecuted: event.providerExecuted,
          },
        ]
      case "tool-result":
        if (event.result.type === "error") {
          return [{ type: "tool-error", toolCallId: event.id, toolName: event.name, input: state.toolInputs.get(event.id) ?? {}, error: stringifyResult(event.result) }]
        }
        return [
          {
            type: "tool-result",
            toolCallId: event.id,
            toolName: event.name,
            input: state.toolInputs.get(event.id) ?? {},
            output: toolResultOutput(event.result),
          },
        ]
      case "tool-error":
        return [{ type: "tool-error", toolCallId: event.id, toolName: event.name, input: state.toolInputs.get(event.id) ?? {}, error: event.message }]
      case "step-finish":
        return finish(event, false)
      case "request-finish":
        return finish(event, true)
      case "provider-error":
        return [{ type: "error", error: new Error(event.message) }]
    }
    return []
  }

  const flush = (): ReadonlyArray<SessionEvent> => closeOpenParts(state)

  return { map, flush }
}

export const toSessionEvents = (events: Iterable<LLMEvent>) => {
  const m = mapper()
  return [...Array.from(events, (event) => m.map(event)).flat(), ...m.flush()]
}

export * as LLMNativeEvents from "./llm-native-events"
