import * as LLM from "./llm"
import type { ToolResultInput } from "./llm"
import type {
  ContentPart,
  FinishReason,
  LLMEvent,
  LLMRequest,
  ToolCallPart,
  ToolResultPart,
} from "./schema"

export type { ToolResultInput } from "./llm"

export interface State {
  assistantContent: ContentPart[]
  clientToolCalls: ToolCallPart[]
  activeContent: { readonly type: "text" | "reasoning"; readonly id: string | undefined } | undefined
  finishReason: FinishReason | undefined
}

export const empty = (): State => ({
  assistantContent: [],
  clientToolCalls: [],
  activeContent: undefined,
  finishReason: undefined,
})

export type Delta =
  | { readonly type: "assistant-content-added"; readonly part: ContentPart }
  | { readonly type: "assistant-content-merged"; readonly part: ContentPart }
  | { readonly type: "client-tool-call-added"; readonly call: ToolCallPart }
  | { readonly type: "provider-tool-result-added"; readonly result: ToolResultPart }
  | { readonly type: "finished"; readonly reason: FinishReason }

export const isClientToolCallAdded = (
  delta: Delta,
): delta is Extract<Delta, { readonly type: "client-tool-call-added" }> =>
  delta.type === "client-tool-call-added"

export const clientToolCallAdded = (deltas: ReadonlyArray<Delta>) => deltas.find(isClientToolCallAdded)?.call

const appendStreamingText = (
  state: State,
  type: "text" | "reasoning",
  text: string,
  options: { readonly id?: string; readonly encrypted?: string; readonly metadata?: Record<string, unknown> } = {},
): Delta => {
  const last = state.assistantContent.at(-1)
  const canMergeID = state.activeContent?.type === type && state.activeContent.id === options.id
  const canMergeSignedReasoning = type === "reasoning" && text === "" && options.encrypted && last?.type === "reasoning" && canMergeID
  const canMergeText = last?.type === type && canMergeID && !options.metadata && !last.metadata && !options.encrypted
  if (canMergeSignedReasoning || canMergeText) {
    const part = {
      ...last,
      text: `${last.text}${text}`,
      ...(type === "reasoning" && options.encrypted ? { encrypted: options.encrypted } : {}),
      metadata: options.metadata ? { ...(last.metadata ?? {}), ...options.metadata } : last.metadata,
    }
    state.assistantContent[state.assistantContent.length - 1] = part
    return { type: "assistant-content-merged", part }
  }
  const part = {
    type,
    text,
    ...(type === "reasoning" && options.encrypted ? { encrypted: options.encrypted } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  }
  state.assistantContent.push(part)
  state.activeContent = { type, id: options.id }
  return { type: "assistant-content-added", part }
}

export const mutate = (state: State, event: LLMEvent): ReadonlyArray<Delta> => {
  if (event.type === "text-delta") {
    return [appendStreamingText(state, "text", event.text, { id: event.id, metadata: event.metadata })]
  }
  if (event.type === "reasoning-delta") {
    return [appendStreamingText(state, "reasoning", event.text, { id: event.id, encrypted: event.encrypted, metadata: event.metadata })]
  }
  if (event.type === "tool-call") {
    const part = LLM.toolCall({
      id: event.id,
      name: event.name,
      input: event.input,
      providerExecuted: event.providerExecuted,
      metadata: event.metadata,
    })
    state.assistantContent.push(part)
    state.activeContent = undefined
    if (event.providerExecuted) return [{ type: "assistant-content-added", part }]
    state.clientToolCalls.push(part)
    return [{ type: "assistant-content-added", part }, { type: "client-tool-call-added", call: part }]
  }
  if (event.type === "tool-result" && event.providerExecuted) {
    const part = LLM.toolResult({
      id: event.id,
      name: event.name,
      result: event.result,
      providerExecuted: true,
    })
    state.assistantContent.push(part)
    state.activeContent = undefined
    return [{ type: "assistant-content-added", part }, { type: "provider-tool-result-added", result: part }]
  }
  if (event.type === "request-finish") {
    state.finishReason = event.reason
    return [{ type: "finished", reason: event.reason }]
  }
  return []
}

export const fold = (events: Iterable<LLMEvent>) => {
  const state = empty()
  for (const event of events) mutate(state, event)
  return state
}

export const needsClientToolResults = (state: State) => state.finishReason === "tool-calls" && state.clientToolCalls.length > 0

export const continueRequest = (input: {
  readonly request: LLMRequest
  readonly state: State
  readonly results: ReadonlyArray<ToolResultInput>
}) =>
  LLM.updateRequest(input.request, {
    messages: [
      ...input.request.messages,
      LLM.assistant(input.state.assistantContent),
      ...input.results.map((result) => LLM.toolResultMessage(result)),
    ],
  })

export * as Conversation from "./conversation"
