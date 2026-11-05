/**
 * One kept session view. Session retention evicts the transcripts of closed sessions, and a detached view would still
 * hold the old transcript and its DOM, so a view whose transcript once loaded and is empty now goes once it is not
 * selected, whichever happened first. `hadTranscript`: a view that never had one, such as a new empty session, stays.
 */
export type TimelineCacheEntryState =
  | { readonly status: "selected"; readonly hadTranscript: boolean }
  | { readonly status: "detached"; readonly hadTranscript: boolean }
  | { readonly status: "evicted" }

export type TimelineCacheEntryEvent = {
  readonly type: "synced"
  readonly selected: boolean
  readonly hasTranscript: boolean
}

const EVICTED: TimelineCacheEntryState = Object.freeze({ status: "evicted" })

export function createTimelineCacheEntryState(input: {
  selected: boolean
  hasTranscript: boolean
}): TimelineCacheEntryState {
  return { status: input.selected ? "selected" : "detached", hadTranscript: input.hasTranscript }
}

export function transitionTimelineCacheEntry(
  state: TimelineCacheEntryState,
  event: TimelineCacheEntryEvent,
): TimelineCacheEntryState {
  if (state.status === "evicted") return state
  const hadTranscript = state.hadTranscript || event.hasTranscript

  if (!event.selected && hadTranscript && !event.hasTranscript) return EVICTED
  const status = event.selected ? "selected" : "detached"

  return status === state.status && hadTranscript === state.hadTranscript ? state : { status, hadTranscript }
}
