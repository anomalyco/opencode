export * as ReflectionState from "./reflection-state"

import { SessionSchema } from "../schema"

export interface State {
  readonly directionConfirmed: boolean
  readonly lastWhyConverged: boolean
  readonly lastThenConverged: boolean
  readonly confirmedAt?: Date
  readonly steers: readonly string[]
}

const store = new Map<string, State>()

const empty: State = {
  directionConfirmed: false,
  lastWhyConverged: false,
  lastThenConverged: false,
  steers: [],
}

export const get = (sessionID: SessionSchema.ID): State => store.get(sessionID) ?? empty

export const set = (sessionID: SessionSchema.ID, state: State): void => {
  store.set(sessionID, state)
}

export const clear = (sessionID: SessionSchema.ID): void => {
  store.delete(sessionID)
}

export const clearDirection = (sessionID: SessionSchema.ID): void => {
  const prev = get(sessionID)
  store.set(sessionID, {
    ...prev,
    directionConfirmed: false,
    lastWhyConverged: false,
    lastThenConverged: false,
  })
}

export const addSteer = (sessionID: SessionSchema.ID, steer: string): void => {
  const prev = get(sessionID)
  store.set(sessionID, {
    ...prev,
    directionConfirmed: false,
    steers: [...prev.steers, steer],
  })
}

export const hasSteers = (sessionID: SessionSchema.ID): boolean => {
  return (store.get(sessionID)?.steers.length ?? 0) > 0
}

export const consumeSteers = (sessionID: SessionSchema.ID): readonly string[] => {
  const prev = store.get(sessionID)
  if (!prev || prev.steers.length === 0) return []
  store.set(sessionID, { ...prev, steers: [] })
  return prev.steers
}

export const consumeSteerGuidanceText = (sessionID: SessionSchema.ID): string | undefined => {
  const steers = consumeSteers(sessionID)
  if (steers.length === 0) return undefined
  return [
    "<reflection_guidance>",
    "The following internal reflection/forward check was projected from recent actions:",
    ...steers,
    "Address these points in your next action or response.",
    "</reflection_guidance>",
  ].join("\n")
}

export const getReflectionText = (sessionID: SessionSchema.ID): string | undefined => {
  const state = get(sessionID)
  if (!state.directionConfirmed) return undefined
  return [
    "<reflection_state>",
    "Direction confirmed: no counter-models or contradictions projected. Invariants validated.",
    "You may proceed confidently without re-checking.",
    `Last reflection: Why=${state.lastWhyConverged ? "converged" : "not run"}, Then=${state.lastThenConverged ? "converged" : "not run"}.`,
    "</reflection_state>",
  ].join("\n")
}
