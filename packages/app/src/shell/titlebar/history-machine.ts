export const MAX_TITLEBAR_HISTORY = 100

/** How long a Back or Forward waits for the router to arrive before it counts as done where the router is. */
export const HISTORY_TRAVERSE_TIMEOUT_MS = 1_000

export type HistoryLocation = { readonly url: string; readonly state?: unknown }

export type TitlebarHistoryState =
  | {
      readonly status: "idle"
      readonly attempt: number
      readonly stack: readonly HistoryLocation[]
      readonly index: number
    }
  | {
      readonly status: "traversing"
      readonly attempt: number
      readonly stack: readonly HistoryLocation[]
      /** The entry the router showed when the traversal started. */
      readonly index: number
      /** The entry Back or Forward is navigating to. */
      readonly targetIndex: number
    }
  | { readonly status: "disposed" }

export type TitlebarHistoryEvent =
  | { readonly type: "location.changed"; readonly current: HistoryLocation; readonly max?: number }
  | { readonly type: "back" }
  | { readonly type: "forward" }
  /** `currentUrl` is the router's URL when the fallback timer fires. */
  | { readonly type: "traverse.timed-out"; readonly attempt: number; readonly currentUrl: string }
  | { readonly type: "disposed" }

export type TitlebarHistoryEffect =
  | { readonly type: "navigate"; readonly attempt: number; readonly to: HistoryLocation; readonly timeoutMs: number }
  | { readonly type: "timer.clear" }

export type TitlebarHistoryTransition = {
  readonly state: TitlebarHistoryState
  readonly effects: readonly TitlebarHistoryEffect[]
}

export const INITIAL_TITLEBAR_HISTORY_STATE: TitlebarHistoryState = { status: "idle", attempt: 0, stack: [], index: 0 }

const NO_EFFECTS: readonly TitlebarHistoryEffect[] = []

const CLEAR: readonly TitlebarHistoryEffect[] = [{ type: "timer.clear" }]

export function transitionTitlebarHistory(
  state: TitlebarHistoryState,
  event: TitlebarHistoryEvent,
): TitlebarHistoryTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed")
    return { state: { status: "disposed" }, effects: state.status === "traversing" ? CLEAR : NO_EFFECTS }

  if (event.type === "back" || event.type === "forward") {
    const cursor = state.status === "traversing" ? state.targetIndex : state.index
    const targetIndex = event.type === "back" ? cursor - 1 : cursor + 1
    const to = state.stack[targetIndex]

    if (!to) return { state, effects: NO_EFFECTS }
    const attempt = state.attempt + 1

    return {
      state: { status: "traversing", attempt, stack: state.stack, index: state.index, targetIndex },
      effects: [{ type: "navigate", attempt, to, timeoutMs: HISTORY_TRAVERSE_TIMEOUT_MS }],
    }
  }

  if (event.type === "traverse.timed-out") {
    if (state.status !== "traversing" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }
    // A navigation the router blocked or ignored never reports a location; the history stays where the router is.
    const arrived = sameRoute({ url: event.currentUrl }, state.stack[state.targetIndex]!)

    return { state: idle(state, state.stack, arrived ? state.targetIndex : state.index), effects: NO_EFFECTS }
  }

  const current = event.current
  const max = event.max ?? MAX_TITLEBAR_HISTORY
  const effects = state.status === "traversing" ? CLEAR : NO_EFFECTS

  if (state.stack.length === 0) {
    const stack = current.url === "/" ? [current] : [{ url: "/" }, current]

    return { state: idle(state, stack, stack.length - 1), effects }
  }

  if (state.status === "traversing") {
    if (sameRoute(current, state.stack[state.targetIndex]!))
      return { state: idle(state, replace(state.stack, state.targetIndex, current), state.targetIndex), effects }

    if (sameRoute(current, state.stack[state.index]!))
      return { state: idle(state, replace(state.stack, state.index, current), state.index), effects }

    // A redirect or another navigation overtook the traversal: the location the router arrived at is a new visit.
    return { state: push(state, current, max), effects }
  }

  const active = state.stack[state.index]!

  if (current.url === active.url && current.state === active.state) return { state, effects }

  if (sameRoute(current, active))
    return { state: idle(state, replace(state.stack, state.index, current), state.index), effects }

  return { state: push(state, current, max), effects }
}

type Live = Exclude<TitlebarHistoryState, { status: "disposed" }>

function idle(state: Live, stack: readonly HistoryLocation[], index: number): TitlebarHistoryState {
  return { status: "idle", attempt: state.attempt, stack, index }
}

function push(state: Live, current: HistoryLocation, max: number) {
  const stack = [...state.stack.slice(0, state.index + 1), current]
  const cut = Math.max(0, stack.length - max)

  return idle(state, stack.slice(cut), stack.length - 1 - cut)
}

function replace(stack: readonly HistoryLocation[], index: number, current: HistoryLocation) {
  return stack.map((entry, at) => (at === index ? current : entry))
}

// Settings tabs and query changes replace one entry rather than stacking a visit each.
function sameRoute(a: HistoryLocation, b: HistoryLocation) {
  return a.url === b.url || (isSettingsPath(a.url) && isSettingsPath(b.url))
}

function isSettingsPath(url: string) {
  return url.split(/[?#]/, 1)[0] === "/settings"
}
