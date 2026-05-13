import { LLMEvent, type FinishReason, type ProviderMetadata, type Usage } from "../../schema"

export interface State {
  readonly stepStarted: boolean
  readonly text: ReadonlySet<string>
  readonly reasoning: ReadonlySet<string>
}

export const initial = (): State => ({ stepStarted: false, text: new Set(), reasoning: new Set() })

export const stepStart = (state: State, events: LLMEvent[]): State => {
  if (state.stepStarted) return state
  events.push(LLMEvent.stepStart({ index: 0 }))
  return { ...state, stepStarted: true }
}

export const textDelta = (state: State, events: LLMEvent[], id: string, text: string): State => {
  const stepped = stepStart(state, events)
  if (stepped.text.has(id)) {
    events.push(LLMEvent.textDelta({ id, text }))
    return stepped
  }
  events.push(LLMEvent.textStart({ id }), LLMEvent.textDelta({ id, text }))
  return { ...stepped, text: new Set([...stepped.text, id]) }
}

export const reasoningDelta = (state: State, events: LLMEvent[], id: string, text: string): State => {
  const stepped = stepStart(state, events)
  if (stepped.reasoning.has(id)) {
    events.push(LLMEvent.reasoningDelta({ id, text }))
    return stepped
  }
  events.push(LLMEvent.reasoningStart({ id }), LLMEvent.reasoningDelta({ id, text }))
  return { ...stepped, reasoning: new Set([...stepped.reasoning, id]) }
}

export const reasoningEnd = (
  state: State,
  events: LLMEvent[],
  id: string,
  providerMetadata?: ProviderMetadata,
): State => {
  if (!state.reasoning.has(id)) return state
  const stepped = stepStart(state, events)
  events.push(LLMEvent.reasoningEnd({ id, providerMetadata }))
  const reasoning = new Set(stepped.reasoning)
  reasoning.delete(id)
  return { ...stepped, reasoning }
}

export const textEnd = (state: State, events: LLMEvent[], id: string, providerMetadata?: ProviderMetadata): State => {
  if (!state.text.has(id)) return state
  const stepped = stepStart(state, events)
  events.push(LLMEvent.textEnd({ id, providerMetadata }))
  const text = new Set(stepped.text)
  text.delete(id)
  return { ...stepped, text }
}

const closeOpenBlocks = (state: State, events: LLMEvent[]): State => {
  for (const id of state.reasoning) events.push(LLMEvent.reasoningEnd({ id }))
  for (const id of state.text) events.push(LLMEvent.textEnd({ id }))
  return { ...state, text: new Set(), reasoning: new Set() }
}

export const finish = (
  state: State,
  events: LLMEvent[],
  input: {
    readonly reason: FinishReason
    readonly usage?: Usage
    readonly providerMetadata?: ProviderMetadata
  },
): State => {
  const stepped = closeOpenBlocks(stepStart(state, events), events)
  events.push(
    LLMEvent.stepFinish({
      index: 0,
      reason: input.reason,
      usage: input.usage,
      providerMetadata: input.providerMetadata,
    }),
    LLMEvent.finish(input),
  )
  return { ...stepped, stepStarted: false }
}

export * as Lifecycle from "./lifecycle"
