import { LLMEvent, type FinishReasonDetails, type ProviderMetadata, type Usage } from "../../schema/index.js"

export interface OpenBlock {
  readonly id: string
  readonly kind: "text" | "reasoning"
  /** Sent on the block's end event when the caller does not pass its own metadata. */
  readonly metadata?: ProviderMetadata
}

export interface State {
  readonly phase: "idle" | "step" | "finished"
  /** Blocks still open, in the order they started. */
  readonly open: ReadonlyArray<OpenBlock>
}

export const initial = (): State => ({ phase: "idle", open: [] })

export const isOpen = (state: State, kind: OpenBlock["kind"], id: string) =>
  state.open.some((block) => block.kind === kind && block.id === id)

export const stepStart = (state: State, events: LLMEvent[]): State => {
  if (state.phase !== "idle") return state
  events.push(LLMEvent.stepStart({ index: 0 }))
  return { ...state, phase: "step" }
}

/** Store metadata to send when an open block ends without explicit metadata. */
export const setMetadata = (
  state: State,
  kind: OpenBlock["kind"],
  id: string,
  metadata: ProviderMetadata | undefined,
): State => ({
  ...state,
  open: state.open.map((block) => (block.kind === kind && block.id === id ? { ...block, metadata } : block)),
})

const start = (
  state: State,
  events: LLMEvent[],
  kind: OpenBlock["kind"],
  id: string,
  providerMetadata?: ProviderMetadata,
): State => {
  if (state.phase === "finished" || isOpen(state, kind, id)) return state
  const stepped = stepStart(state, events)
  events.push(
    kind === "text" ? LLMEvent.textStart({ id, providerMetadata }) : LLMEvent.reasoningStart({ id, providerMetadata }),
  )
  return { ...stepped, open: [...stepped.open, { id, kind }] }
}

const end = (
  state: State,
  events: LLMEvent[],
  kind: OpenBlock["kind"],
  id: string,
  providerMetadata?: ProviderMetadata,
  text?: string,
): State => {
  const block = state.open.find((block) => block.kind === kind && block.id === id)
  if (!block) return state
  const metadata = providerMetadata ?? block.metadata
  events.push(
    kind === "text"
      ? LLMEvent.textEnd({ id, text, providerMetadata: metadata })
      : LLMEvent.reasoningEnd({ id, text, providerMetadata: metadata }),
  )
  return { ...state, open: state.open.filter((open) => open !== block) }
}

export const textStart = (state: State, events: LLMEvent[], id: string, providerMetadata?: ProviderMetadata): State =>
  start(state, events, "text", id, providerMetadata)

export const textDelta = (
  state: State,
  events: LLMEvent[],
  id: string,
  text: string,
  providerMetadata?: ProviderMetadata,
): State => {
  if (state.phase === "finished") return state
  const started = textStart(state, events, id)
  events.push(LLMEvent.textDelta({ id, text, providerMetadata }))
  return started
}

export const reasoningStart = (
  state: State,
  events: LLMEvent[],
  id: string,
  providerMetadata?: ProviderMetadata,
): State => start(state, events, "reasoning", id, providerMetadata)

export const reasoningDelta = (
  state: State,
  events: LLMEvent[],
  id: string,
  text: string,
  providerMetadata?: ProviderMetadata,
): State => {
  if (state.phase === "finished") return state
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
): State => end(state, events, "reasoning", id, providerMetadata, text)

export const textEnd = (
  state: State,
  events: LLMEvent[],
  id: string,
  providerMetadata?: ProviderMetadata,
  /** Authoritative complete value; replaces accumulated deltas when present. */
  text?: string,
): State => end(state, events, "text", id, providerMetadata, text)

export const finish = (
  state: State,
  events: LLMEvent[],
  input: {
    readonly reason: FinishReasonDetails
    readonly usage?: Usage
    readonly providerMetadata?: ProviderMetadata
  },
): State => {
  if (state.phase === "finished") return state
  stepStart(state, events)
  // Open blocks close in the order they started, each with its stored metadata.
  for (const block of state.open) end(state, events, block.kind, block.id)
  events.push(
    LLMEvent.stepFinish({
      index: 0,
      reason: input.reason,
      usage: input.usage,
      providerMetadata: input.providerMetadata,
    }),
    LLMEvent.finish(input),
  )
  return { phase: "finished", open: [] }
}

export * as Lifecycle from "./lifecycle.js"
