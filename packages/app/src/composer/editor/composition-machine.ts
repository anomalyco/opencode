export type CompositionState = { type: "idle" } | { type: "composing" }

export type CompositionEvent = { type: "composition.start" } | { type: "composition.end" }

export const INITIAL_COMPOSITION_STATE: CompositionState = { type: "idle" }

const COMPOSING: CompositionState = { type: "composing" }

export function transitionComposition(state: CompositionState, event: CompositionEvent): CompositionState {
  if (event.type === "composition.start") return state.type === "composing" ? state : COMPOSING

  return state.type === "idle" ? state : INITIAL_COMPOSITION_STATE
}

export function isComposing(state: CompositionState) {
  return state.type === "composing"
}
