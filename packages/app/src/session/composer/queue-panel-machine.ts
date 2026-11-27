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
  /** The prompt's full text is shown in place of the single-line summary. */
  readonly expanded: boolean
}

/** The queue's whole list is shown, or reduced to the compact summary that reopens it. */
export type QueuePanelList = "expanded" | "collapsed"

/**
 * The pullout above the composer. `closing` keeps drawing its last prompts while it closes; `closed` draws nothing, so
 * it holds only the current prompts. `list` is the whole queue, separate from each prompt's own `expanded` state.
 * `cascade` is the stagger of the rows fading in as the panel opens, set until the panel leaves `open`; `attempt`
 * advances on every change of phase, so a cascade for an earlier opening never starts.
 */
export type QueuePanelState =
  | {
      readonly status: "closed"
      readonly attempt: number
      readonly entries: readonly QueuePanelEntry[]
      readonly list: QueuePanelList
    }
  | {
      readonly status: "open"
      readonly attempt: number
      readonly entries: readonly QueuePanelEntry[]
      readonly list: QueuePanelList
      readonly cascade?: number
    }
  | {
      readonly status: "closing"
      readonly attempt: number
      readonly entries: readonly QueuePanelEntry[]
      readonly list: QueuePanelList
    }
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
  | { readonly type: "row.expanded"; readonly id: string; readonly expanded: boolean }
  | { readonly type: "list.expanded"; readonly expanded: boolean }
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
  return {
    status: !hidden && rows.length > 0 ? "open" : "closed",
    attempt: 0,
    entries: present(rows),
    list: "expanded",
  }
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
    // A closing panel keeps the shape it had, so emptying a collapsed queue does not flash the rows on the way out.
    const list = open ? nextList(state.list, event.rows.length) : state.list

    // Nothing is drawn, so prompts that left meanwhile leave no rows behind. The prompts still queued keep the
    // expansion they had before the panel was hidden.
    if (state.status === "closed" && !open)
      return {
        state: { ...state, entries: present(event.rows, state.entries, event.moved), list },
        effects: NO_EFFECTS,
      }

    if (state.status === "open" && open)
      return {
        state: { ...state, entries: reconcile(state.entries, event.rows, event.moved, event.hidden), list },
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

      if (state.status === "closing") return { state: { ...state, entries, list }, effects: NO_EFFECTS }

      return {
        state: { status: "closing", attempt: state.attempt + 1, entries, list },
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
            ? present(event.rows, state.entries, event.moved)
            : reconcile(state.entries, event.rows, event.moved, event.hidden),
        list,
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

  if (event.type === "row.expanded") {
    if (state.status !== "open") return unchanged(state)

    const entry = state.entries.find((item) => item.id === event.id)

    if (!entry || entry.phase === "leaving" || entry.expanded === event.expanded) return unchanged(state)

    return {
      state: {
        ...state,
        entries: state.entries.map((item) => (item.id === event.id ? { ...item, expanded: event.expanded } : item)),
      },
      effects: NO_EFFECTS,
    }
  }

  if (event.type === "list.expanded") {
    if (state.status !== "open") return unchanged(state)

    // A single prompt has no bulk visibility to toggle: its own row disclosure is the only expansion it needs.
    const live = state.entries.filter((entry) => entry.phase !== "leaving")

    if (!event.expanded && live.length <= 1) return unchanged(state)
    const list = event.expanded ? "expanded" : "collapsed"

    if (list === state.list) return unchanged(state)

    return { state: { ...state, list }, effects: NO_EFFECTS }
  }

  if (event.type === "row.closed") {
    if (state.status !== "open" || !state.entries.some((entry) => entry.id === event.id && entry.phase === "leaving"))
      return unchanged(state)

    return { state: { ...state, entries: state.entries.filter((entry) => entry.id !== event.id) }, effects: NO_EFFECTS }
  }

  if (state.status !== "closing") return unchanged(state)

  const entries = state.entries.flatMap((entry) =>
    entry.phase === "leaving" ? [] : [entry.phase === "present" ? entry : { ...entry, phase: "present" as const }],
  )

  return {
    state: {
      status: "closed",
      attempt: state.attempt + 1,
      entries,
      // An emptied queue reopens in full; a panel hidden over live prompts keeps its summary.
      list: entries.length ? state.list : "expanded",
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

/** Whether the whole queued-message list is shown rather than reduced to its summary. */
export function queuePanelListExpanded(state: QueuePanelState) {
  return state.status !== "disposed" && state.list === "expanded"
}

/** Whether any prompt still queued is expanded. */
export function queuePanelAnyExpanded(state: QueuePanelState) {
  if (state.status === "disposed" || state.status === "closed") return false

  return state.entries.some((entry) => entry.phase !== "leaving" && entry.expanded)
}

// A queue too short to need a bulk control comes back in full, so its prompts can never stay hidden behind a summary.
function nextList(list: QueuePanelList, rows: number): QueuePanelList {
  return rows === 1 ? "expanded" : list
}

function present(
  rows: readonly QueueRow[],
  previous: readonly QueuePanelEntry[] = [],
  moved: Readonly<Record<string, string>> = {},
): QueuePanelEntry[] {
  const listed = new Set(rows.map((row) => row.id))
  const carried = carriedExpansion(previous, moved, listed)

  return rows.map((row) => {
    const before = previous.find((entry) => entry.id === row.id)

    return { id: row.id, row, phase: "present", expanded: before?.expanded ?? carried.get(row.id) ?? false }
  })
}

// Expansion follows a prompt whose inbox ID an edit or reorder replaced, even while its row keeps animating in place.
function carriedExpansion(
  previous: readonly QueuePanelEntry[],
  moved: Readonly<Record<string, string>>,
  listed: ReadonlySet<string>,
) {
  const carried = new Map<string, boolean>()

  previous.forEach((entry) => {
    if (entry.phase === "leaving" || listed.has(entry.id)) return
    const target = movedTarget(moved, entry.id, listed)

    if (target !== undefined) carried.set(target, entry.expanded)
  })

  return carried
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
  const carried = carriedExpansion(previous, moved, listed)

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
    const expanded = before?.expanded ?? carried.get(row.id) ?? false

    return before && before.row === row && before.phase === kept && before.expanded === expanded
      ? before
      : { id: row.id, row, phase: kept, expanded }
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
