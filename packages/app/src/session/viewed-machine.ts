export type SessionViewedState =
  | { readonly status: "waiting"; readonly sessionID?: string }
  | { readonly status: "viewed"; readonly sessionID: string }

export type SessionViewedEvent = {
  readonly type: "changed"
  readonly sessionID: string | undefined
  readonly focused: boolean
  readonly ready: boolean
}

export const INITIAL_SESSION_VIEWED_STATE: SessionViewedState = Object.freeze({ status: "waiting" })

export function transitionSessionViewed(state: SessionViewedState, event: SessionViewedEvent): SessionViewedState {
  if (!event.sessionID) return INITIAL_SESSION_VIEWED_STATE

  if (state.status === "viewed" && state.sessionID === event.sessionID) return state

  if (event.focused && event.ready) return { status: "viewed", sessionID: event.sessionID }

  if (state.sessionID === event.sessionID) return state

  return { status: "waiting", sessionID: event.sessionID }
}
