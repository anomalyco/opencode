import { LLMEvent, type FinishReasonDetails, type ProviderMetadata, type Usage } from "../../schema/index.js"

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

export const textStart = (state: State, events: LLMEvent[], id: string, providerMetadata?: ProviderMetadata): State => {
  if (state.text.has(id)) return state
  const stepped = stepStart(state, events)
  // Normalize overlapping boundaries: close all open text fragments before starting a new
  // one. Without this, gateways that stream overlapping blocks (e.g. Anthropic-compatible
  // gateways with overlapping content_block_start) produce "text start before end" errors
  // in the session runner, which only allows one open fragment at a time.
  const closed = [...stepped.text].reduce(
    (acc, openId) => textEnd(acc, events, openId),
    stepped,
  )
  events.push(LLMEvent.textStart({ id, providerMetadata }))
  return { ...closed, text: new Set([id]) }
}

export const textDelta = (
  state: State,
  events: LLMEvent[],
  id: string,
  text: string,
  providerMetadata?: ProviderMetadata,
): State => {
  const started = textStart(state, events, id)
  events.push(LLMEvent.textDelta({ id, text, providerMetadata }))
  return started
}

export const reasoningStart = (
  state: State,
  events: LLMEvent[],
  id: string,
  providerMetadata?: ProviderMetadata,
): State => {
  if (state.reasoning.has(id)) return state
  const stepped = stepStart(state, events)
  // Normalize overlapping boundaries: close all open reasoning fragments before starting a
  // new one. See textStart for details.
  const closed = [...stepped.reasoning].reduce(
    (acc, openId) => reasoningEnd(acc, events, openId),
    stepped,
  )
  events.push(LLMEvent.reasoningStart({ id, providerMetadata }))
  return { ...closed, reasoning: new Set([id]) }
}

export const reasoningDelta = (
  state: State,
  events: LLMEvent[],
  id: string,
  text: string,
  providerMetadata?: ProviderMetadata,
): State => {
  const started = reasoningStart(state, events, id, providerMetadata)
  events.push(LLMEvent.reasoningDelta({ id, text, providerMetadata }))
  return started
}

export const reasoningEnd = (
  state: State,
  events: LLMEvent[],
  id: string,
  providerMetadata?: ProviderMetadata,
  /** Authoritative complete value; replaces accumulated deltas when present. */
  text?: string,
): State => {
  if (!state.reasoning.has(id)) return state
  const stepped = stepStart(state, events)
  events.push(LLMEvent.reasoningEnd({ id, text, providerMetadata }))
  const reasoning = new Set(stepped.reasoning)
  reasoning.delete(id)
  return { ...stepped, reasoning }
}

export const textEnd = (
  state: State,
  events: LLMEvent[],
  id: string,
  providerMetadata?: ProviderMetadata,
  /** Authoritative complete value; replaces accumulated deltas when present. */
  text?: string,
): State => {
  if (!state.text.has(id)) return state
  const stepped = stepStart(state, events)
  events.push(LLMEvent.textEnd({ id, text, providerMetadata }))
  const open = new Set(stepped.text)
  open.delete(id)
  return { ...stepped, text: open }
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
    readonly reason: FinishReasonDetails
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

export * as Lifecycle from "./lifecycle.js"
