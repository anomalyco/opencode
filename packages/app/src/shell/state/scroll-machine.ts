// Session scroll positions wait in a debounce before they are written to the layout store. `dirty` holds the sessions
// with a write still waiting.
export type ScrollPersistenceState =
  | { readonly status: "active"; readonly dirty: ReadonlySet<string> }
  | { readonly status: "disposed" }

export type ScrollPersistenceEvent =
  | { readonly type: "edited"; readonly sessionKey: string }
  // The session's debounce ended, or something asked for its write now.
  | { readonly type: "flushed"; readonly sessionKey: string }
  | { readonly type: "flush-all" }
  | { readonly type: "dropped"; readonly sessionKeys: readonly string[] }
  | { readonly type: "disposed" }

export type ScrollPersistenceEffect =
  | { readonly type: "timer.schedule"; readonly sessionKey: string }
  | { readonly type: "timer.clear"; readonly sessionKeys: readonly string[] }
  | { readonly type: "flush"; readonly sessionKeys: readonly string[] }
  | { readonly type: "cache.drop"; readonly sessionKeys: readonly string[] }

export type ScrollPersistenceTransition = {
  readonly state: ScrollPersistenceState
  readonly effects: readonly ScrollPersistenceEffect[]
}

export const INITIAL_SCROLL_PERSISTENCE_STATE: ScrollPersistenceState = Object.freeze({
  status: "active",
  dirty: new Set<string>(),
})

const DISPOSED_SCROLL_PERSISTENCE_STATE: ScrollPersistenceState = Object.freeze({ status: "disposed" })

const NO_EFFECTS: readonly ScrollPersistenceEffect[] = Object.freeze([])

export function transitionScrollPersistence(
  state: ScrollPersistenceState,
  event: ScrollPersistenceEvent,
): ScrollPersistenceTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "edited") {
    const effects = [{ type: "timer.schedule", sessionKey: event.sessionKey }] as const

    // Every scroll frame reschedules the debounce; only the first one in a window changes the state.
    if (state.dirty.has(event.sessionKey)) return { state, effects }

    return { state: { status: "active", dirty: new Set(state.dirty).add(event.sessionKey) }, effects }
  }

  // The last positions are written on the way out instead of waiting for a debounce that will never fire.
  if (event.type === "disposed") return { state: DISPOSED_SCROLL_PERSISTENCE_STATE, effects: write([...state.dirty]) }

  if (event.type === "flushed") {
    if (!state.dirty.has(event.sessionKey)) return { state, effects: NO_EFFECTS }

    return { state: without(state, [event.sessionKey]), effects: write([event.sessionKey]) }
  }

  if (event.type === "flush-all") {
    if (state.dirty.size === 0) return { state, effects: NO_EFFECTS }

    return { state: INITIAL_SCROLL_PERSISTENCE_STATE, effects: write([...state.dirty]) }
  }

  if (event.sessionKeys.length === 0) return { state, effects: NO_EFFECTS }
  const dirty = event.sessionKeys.filter((key) => state.dirty.has(key))

  return {
    state: dirty.length === 0 ? state : without(state, dirty),
    effects: [
      ...(dirty.length === 0 ? [] : [{ type: "timer.clear" as const, sessionKeys: dirty }]),
      { type: "cache.drop", sessionKeys: event.sessionKeys },
    ],
  }
}

export function isScrollPersistenceDisposed(state: ScrollPersistenceState) {
  return state.status === "disposed"
}

function write(sessionKeys: readonly string[]): readonly ScrollPersistenceEffect[] {
  if (sessionKeys.length === 0) return NO_EFFECTS

  return [
    { type: "timer.clear", sessionKeys },
    { type: "flush", sessionKeys },
  ]
}

function without(state: Extract<ScrollPersistenceState, { status: "active" }>, sessionKeys: readonly string[]) {
  const dirty = new Set([...state.dirty].filter((key) => !sessionKeys.includes(key)))

  return dirty.size === 0 ? INITIAL_SCROLL_PERSISTENCE_STATE : { status: "active" as const, dirty }
}
