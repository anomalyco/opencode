export * as ReflectionState from "./reflection-state"

import { SessionSchema } from "../schema"

export interface State {
  readonly directionConfirmed: boolean
  readonly lastWhyConverged: boolean
  readonly lastThenConverged: boolean
  readonly confirmedAt?: Date
}

const store = new Map<string, State>()

const empty: State = {
  directionConfirmed: false,
  lastWhyConverged: false,
  lastThenConverged: false,
}

export const get = (sessionID: SessionSchema.ID): State => store.get(sessionID) ?? empty

export const set = (sessionID: SessionSchema.ID, state: State): void => {
  store.set(sessionID, state)
}

export const clear = (sessionID: SessionSchema.ID): void => {
  store.delete(sessionID)
}

export const getReflectionText = (sessionID: SessionSchema.ID): string | undefined => {
  const state = get(sessionID)
  if (!state.directionConfirmed) return undefined
  return [
    "<reflection_state>",
    "Direction confirmed: no issues projected. Your approach is validated.",
    "You may proceed confidently without re-checking.",
    `Last reflection: Why=${state.lastWhyConverged ? "converged" : "not run"}, Then=${state.lastThenConverged ? "converged" : "not run"}.`,
    "</reflection_state>",
  ].join("\n")
}
