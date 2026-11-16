/** How long a new compaction waits before showing Compacting; session-compaction.css delays its fade by the same. */
export const COMPACTION_GRACE_MS = 400

/** A compaction that finished at most this long ago when it mounts still fades in. */
export const COMPACTION_RECENT_DONE_MS = 1_000

/**
 * How a quiet compaction divider enters.
 * - `grace`: new and running; CSS holds it hidden for the grace, and finishing inside it switches to `instant`.
 * - `revealed`: the grace passed while it ran. It keeps the grace styling so its animations do not restart, and a
 *   later finish rolls Compacting to Compacted in place.
 * - `instant`: it finished inside the grace, or had just finished when it mounted; it fades in as Compacted only.
 * - `settled`: it was already running or finished when the history loaded; no entrance.
 */
export type CompactionEntranceState =
  | { readonly status: "grace" }
  | { readonly status: "revealed" }
  | { readonly status: "instant" }
  | { readonly status: "settled" }
  | { readonly status: "disposed" }

export type CompactionEntranceEvent =
  | { readonly type: "running.changed"; readonly running: boolean }
  | { readonly type: "grace.elapsed" }
  | { readonly type: "disposed" }

export type CompactionEntranceEffect =
  | { readonly type: "schedule-grace"; readonly delayMs: number }
  | { readonly type: "cancel-grace" }

export type CompactionEntranceTransition = {
  readonly state: CompactionEntranceState
  readonly effects: readonly CompactionEntranceEffect[]
}

const GRACE: CompactionEntranceState = Object.freeze({ status: "grace" })

const REVEALED: CompactionEntranceState = Object.freeze({ status: "revealed" })

const INSTANT: CompactionEntranceState = Object.freeze({ status: "instant" })

const SETTLED: CompactionEntranceState = Object.freeze({ status: "settled" })

const DISPOSED: CompactionEntranceState = Object.freeze({ status: "disposed" })

const NO_EFFECTS: readonly CompactionEntranceEffect[] = Object.freeze([])

const SCHEDULE_GRACE: readonly CompactionEntranceEffect[] = Object.freeze([
  Object.freeze({ type: "schedule-grace", delayMs: COMPACTION_GRACE_MS }),
])

const CANCEL_GRACE: readonly CompactionEntranceEffect[] = Object.freeze([Object.freeze({ type: "cancel-grace" })])

export const GRACE_ELAPSED_EVENT: CompactionEntranceEvent = Object.freeze({ type: "grace.elapsed" })

export const DISPOSED_COMPACTION_ENTRANCE_EVENT: CompactionEntranceEvent = Object.freeze({ type: "disposed" })

/** `ageMs` is how long ago the compaction started, when the divider mounts. */
export function createCompactionEntranceState(input: {
  ageMs: number
  running: boolean
}): CompactionEntranceTransition {
  if (input.running && input.ageMs < COMPACTION_GRACE_MS) return { state: GRACE, effects: SCHEDULE_GRACE }

  if (!input.running && input.ageMs < COMPACTION_RECENT_DONE_MS) return { state: INSTANT, effects: NO_EFFECTS }

  return { state: SETTLED, effects: NO_EFFECTS }
}

export function transitionCompactionEntrance(
  state: CompactionEntranceState,
  event: CompactionEntranceEvent,
): CompactionEntranceTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed")
    return { state: DISPOSED, effects: state.status === "grace" ? CANCEL_GRACE : NO_EFFECTS }

  if (state.status !== "grace") return { state, effects: NO_EFFECTS }

  if (event.type === "grace.elapsed") return { state: REVEALED, effects: NO_EFFECTS }

  return event.running ? { state, effects: NO_EFFECTS } : { state: INSTANT, effects: CANCEL_GRACE }
}

/** The divider's `data-enter`: `revealed` keeps `grace` so its delayed animations do not restart. */
export function selectCompactionEnter(state: CompactionEntranceState) {
  if (state.status === "grace" || state.status === "revealed") return "grace"

  if (state.status === "instant") return "now"

  return undefined
}
