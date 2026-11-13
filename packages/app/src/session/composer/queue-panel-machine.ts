import { movedTarget, type QueueRow } from "./queue-machine"

/**
 * `entering`: a prompt queued into an open panel, which grows in when it mounts. `leaving`: a prompt gone from the queue,
 * drawn in its slot while it closes.
 */
export type QueuePanelRowPhase = "entering" | "present" | "leaving"

export type QueuePanelEntry = {
  readonly id: string
  readonly row: QueueRow
  readonly phase: QueuePanelRowPhase
}

/**
 * The pullout above the composer. `closing` keeps drawing its last prompts while it closes; `closed` draws nothing, so
 * it holds only the current prompts. `cascade` is the stagger of the rows fading in as the panel opens, set until the
 * panel leaves `open`; `attempt` advances on every change of phase, so a cascade for an earlier opening never starts.
 */
export type QueuePanelState =
  | { readonly status: "closed"; readonly attempt: number; readonly entries: readonly QueuePanelEntry[] }
  | {
      readonly status: "open"
      readonly attempt: number
      readonly entries: readonly QueuePanelEntry[]
      readonly cascade?: number
    }
  | { readonly status: "closing"; readonly attempt: number; readonly entries: readonly QueuePanelEntry[] }
  | { readonly status: "disposed" }

export type QueuePanelEvent =
  | {
      readonly type: "sync"
      readonly rows: readonly QueueRow[]
      /** Inbox IDs an edit or reorder replaced, mapped to their replacements. */
      readonly moved: Readonly<Record<string, string>>
      readonly hidden: boolean
      readonly stagger: number
      readonly reducedMotion: boolean
    }
  | { readonly type: "cascade.ready"; readonly attempt: number }
  | { readonly type: "row.closed"; readonly id: string }
  | { readonly type: "panel.closed" }
  | { readonly type: "disposed" }

export type QueuePanelEffect =
  | { readonly type: "cascade.schedule"; readonly attempt: number }
  | { readonly type: "cascade.paint"; readonly step: number }
  | { readonly type: "cascade.cancel" }

export type QueuePanelTransition = {
  readonly state: QueuePanelState
  readonly effects: readonly QueuePanelEffect[]
}

export const PANEL_CLOSED_EVENT: QueuePanelEvent = Object.freeze({ type: "panel.closed" })

export const DISPOSED_QUEUE_PANEL_EVENT: QueuePanelEvent = Object.freeze({ type: "disposed" })

const NO_EFFECTS: readonly QueuePanelEffect[] = Object.freeze([])

const CASCADE_CANCEL: readonly QueuePanelEffect[] = Object.freeze([{ type: "cascade.cancel" }])

const DISPOSED_STATE: QueuePanelState = Object.freeze({ status: "disposed" })

export function createQueuePanelState(rows: readonly QueueRow[], hidden: boolean): QueuePanelState {
  return { status: !hidden && rows.length > 0 ? "open" : "closed", attempt: 0, entries: present(rows) }
}

export function transitionQueuePanel(state: QueuePanelState, event: QueuePanelEvent): QueuePanelTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: DISPOSED_STATE,
      effects: state.status === "open" && state.cascade !== undefined ? CASCADE_CANCEL : NO_EFFECTS,
    }

  if (event.type === "sync") {
    const open = !event.hidden && event.rows.length > 0

    // Nothing is drawn, so prompts that left meanwhile leave no rows behind.
    if (state.status === "closed" && !open)
      return { state: { ...state, entries: present(event.rows) }, effects: NO_EFFECTS }

    if (state.status === "open" && open)
      return {
        state: { ...state, entries: reconcile(state.entries, event.rows, event.moved, event.hidden) },
        effects: NO_EFFECTS,
      }

    if (!open) {
      // The last prompts stay drawn while the emptied panel closes.
      const entries =
        event.rows.length === 0
          ? state.status === "open"
            ? state.entries.map((entry) =>
                entry.phase === "leaving" ? entry : { ...entry, phase: "leaving" as const },
              )
            : state.entries
          : reconcile(state.entries, event.rows, event.moved, event.hidden)

      if (state.status === "closing") return { state: { ...state, entries }, effects: NO_EFFECTS }

      return {
        state: { status: "closing", attempt: state.attempt + 1, entries },
        effects: state.status === "open" && state.cascade !== undefined ? CASCADE_CANCEL : NO_EFFECTS,
      }
    }

    // The panel opens with prompts already queued, such as after a dock closes, so its rows can cascade in.
    const attempt = state.attempt + 1
    const cascade = event.stagger > 0 && !event.reducedMotion ? event.stagger : undefined

    return {
      state: {
        status: "open",
        attempt,
        entries:
          state.status === "closed"
            ? present(event.rows)
            : reconcile(state.entries, event.rows, event.moved, event.hidden),
        cascade,
      },
      effects: cascade === undefined ? NO_EFFECTS : [{ type: "cascade.schedule", attempt }],
    }
  }

  if (event.type === "cascade.ready") {
    if (state.status !== "open" || state.attempt !== event.attempt || state.cascade === undefined)
      return unchanged(state)

    return { state, effects: [{ type: "cascade.paint", step: state.cascade }] }
  }

  if (event.type === "row.closed") {
    if (state.status !== "open" || !state.entries.some((entry) => entry.id === event.id && entry.phase === "leaving"))
      return unchanged(state)

    return { state: { ...state, entries: state.entries.filter((entry) => entry.id !== event.id) }, effects: NO_EFFECTS }
  }

  if (state.status !== "closing") return unchanged(state)

  return {
    state: {
      status: "closed",
      attempt: state.attempt + 1,
      entries: state.entries.flatMap((entry) =>
        entry.phase === "leaving" ? [] : [entry.phase === "present" ? entry : { ...entry, phase: "present" as const }],
      ),
    },
    effects: NO_EFFECTS,
  }
}

export function isQueuePanelOpen(state: QueuePanelState) {
  return state.status === "open"
}

/** The prompts the header counts: the queued ones while open, every drawn one while closing. */
export function queuePanelCount(state: QueuePanelState) {
  if (state.status === "disposed") return 0

  if (state.status !== "open") return state.entries.length

  return state.entries.filter((entry) => entry.phase !== "leaving").length
}

export function selectQueuePanelIDs(state: QueuePanelState) {
  return state.status === "disposed" ? [] : state.entries.map((entry) => entry.id)
}

export function selectQueuePanelLiveIDs(state: QueuePanelState) {
  return state.status === "disposed"
    ? []
    : state.entries.flatMap((entry) => (entry.phase === "leaving" ? [] : [entry.id]))
}

export function queuePanelEntry(state: QueuePanelState, id: string) {
  return state.status === "disposed" ? undefined : state.entries.find((entry) => entry.id === id)
}

function present(rows: readonly QueueRow[]): QueuePanelEntry[] {
  return rows.map((row) => ({ id: row.id, row, phase: "present" }))
}

// A prompt whose inbox ID an edit or reorder replaced swaps in place under its new ID; any other prompt that left
// closes in its slot, and a new one grows in unless the panel is opening around it.
function reconcile(
  previous: readonly QueuePanelEntry[],
  rows: readonly QueueRow[],
  moved: Readonly<Record<string, string>>,
  hidden: boolean,
): QueuePanelEntry[] {
  const listed = new Set(rows.map((row) => row.id))
  const live = previous.filter((entry) => entry.phase !== "leaving")

  const swapped = new Set(
    live.flatMap((entry) => {
      if (listed.has(entry.id)) return []
      const target = movedTarget(moved, entry.id, listed)

      return target === undefined ? [] : [entry.id, target]
    }),
  )

  const next = rows.map((row): QueuePanelEntry => {
    const before = previous.find((entry) => entry.id === row.id)
    const phase = before || swapped.has(row.id) || live.length === 0 || hidden ? "present" : "entering"
    const kept = before?.phase === "entering" ? "entering" : phase

    return before && before.row === row && before.phase === kept ? before : { id: row.id, row, phase: kept }
  })

  // A closing row keeps its place after the prompt it followed.
  previous.forEach((entry, index) => {
    if (listed.has(entry.id) || swapped.has(entry.id)) return
    const anchor = previous.slice(0, index).findLast((item) => next.some((placed) => placed.id === item.id))
    const at = anchor ? next.findIndex((placed) => placed.id === anchor.id) + 1 : 0
    next.splice(at, 0, entry.phase === "leaving" ? entry : { ...entry, phase: "leaving" })
  })

  return next
}

function unchanged(state: QueuePanelState): QueuePanelTransition {
  return { state, effects: NO_EFFECTS }
}
