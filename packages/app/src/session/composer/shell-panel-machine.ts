import type { SessionActivityItem } from "./activity-chips"

/** A Stop that has not settled by then counts as failed, so the button cannot stay disabled. */
export const SHELL_STOP_TIMEOUT_MS = 10_000

/** How a shell that left the running list ended; past this it counts as stopped, so its panel cannot stay pending. */
export const SHELL_END_TIMEOUT_MS = 5_000

export type ShellEnd = {
  readonly status: "exited" | "timeout" | "killed"
  readonly exit?: number
  /** When the shell stopped, so its run time freezes there. */
  readonly completed: number
}

export type ShellEndInfo = Omit<ShellEnd, "completed"> & { readonly completed?: number }

/**
 * The shown shell. `ending`: it left the running list and the panel waits for how it ended. A Stop in flight is not a
 * phase: it lives in `stopping`, shared with the list's rows.
 */
export type ShellPanelPhase =
  | { readonly status: "running" }
  | { readonly status: "ending"; readonly attempt: number }
  | { readonly status: "ended"; readonly end: ShellEnd }

type ShellPanelBase = {
  readonly issued: number
  /** Matches the focus move queued by the last view change; a later change drops it. */
  readonly focusAttempt: number
  readonly enter: boolean
  /** Stops in flight, by item key, whether a list row or the shell panel sent them. Closing the menu keeps them. */
  readonly stopping: Readonly<Record<string, number>>
}

/**
 * The background work menu: shut, open on the list, or open on one shell. A shell that ends while it is shown keeps
 * its panel, with how it ended, until the user goes back or closes the menu. `enter`: the capsule fades in when it
 * next appears, because it was absent once while this composer was mounted.
 */
export type ShellPanelState =
  | (ShellPanelBase & { readonly status: "closed" })
  | (ShellPanelBase & { readonly status: "list" })
  | (ShellPanelBase & {
      readonly status: "shell"
      readonly item: SessionActivityItem
      readonly phase: ShellPanelPhase
    })
  | { readonly status: "disposed" }

/** What runs in the background right now. `enabled`: the background activity setting shows the capsule. */
export type ShellPanelWork = {
  readonly enabled: boolean
  readonly subagents: readonly SessionActivityItem[]
  readonly shells: readonly SessionActivityItem[]
}

export type ShellPanelEvent =
  | { readonly type: "work.synced"; readonly work: ShellPanelWork }
  | { readonly type: "menu.toggled"; readonly open: boolean; readonly work: ShellPanelWork }
  | { readonly type: "shell.selected"; readonly item: SessionActivityItem; readonly work: ShellPanelWork }
  | { readonly type: "back.requested"; readonly work: ShellPanelWork }
  /** `item`: a list row's Stop; without it, the shown shell's. */
  | { readonly type: "stop.requested"; readonly item?: SessionActivityItem; readonly work: ShellPanelWork }
  | {
      readonly type: "stop.settled"
      readonly attempt: number
      readonly stopped: boolean
      readonly work: ShellPanelWork
      readonly now: number
    }
  | { readonly type: "stop.timed-out"; readonly attempt: number; readonly work: ShellPanelWork }
  | {
      readonly type: "ended.settled"
      readonly attempt: number
      readonly info: ShellEndInfo | undefined
      readonly now: number
    }
  | { readonly type: "ended.timed-out"; readonly attempt: number; readonly now: number }
  | { readonly type: "disposed" }

/** Timers are keyed by attempt, one per Stop in flight plus the shown shell's end; `focus.*` replace one frame. */
export type ShellPanelEffect =
  | { readonly type: "stop.run"; readonly attempt: number; readonly item: SessionActivityItem }
  | { readonly type: "ended.load"; readonly attempt: number; readonly id: string }
  | { readonly type: "timer.start"; readonly attempt: number; readonly phase: "stopping" | "ending" }
  /** Without `attempt`, cancels every timer. */
  | { readonly type: "timer.cancel"; readonly attempt?: number }
  | { readonly type: "focus.back"; readonly attempt: number }
  | { readonly type: "focus.row"; readonly attempt: number; readonly key: string }
  | { readonly type: "focus.empty" }
  | { readonly type: "focus.ended" }
  | { readonly type: "focus.cancel" }

export type ShellPanelTransition = {
  readonly state: ShellPanelState
  readonly effects: readonly ShellPanelEffect[]
}

const NO_EFFECTS: readonly ShellPanelEffect[] = Object.freeze([])

const NO_STOPS: Readonly<Record<string, number>> = Object.freeze({})

const TIMERS_CANCEL: ShellPanelEffect = Object.freeze({ type: "timer.cancel" })

const FOCUS_CANCEL: ShellPanelEffect = Object.freeze({ type: "focus.cancel" })

const FOCUS_EMPTY: ShellPanelEffect = Object.freeze({ type: "focus.empty" })

const FOCUS_ENDED: ShellPanelEffect = Object.freeze({ type: "focus.ended" })

const DISPOSED: ShellPanelState = Object.freeze({ status: "disposed" })

/** `active`: the capsule already shows on mount, so it stays at rest rather than fading in. */
export function createShellPanelState(input: { active: boolean }): ShellPanelState {
  return { status: "closed", issued: 0, focusAttempt: 0, enter: !input.active, stopping: NO_STOPS }
}

export function transitionShellPanel(state: ShellPanelState, event: ShellPanelEvent): ShellPanelTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return changed(DISPOSED, [TIMERS_CANCEL, FOCUS_CANCEL])

  if (event.type === "work.synced") return workSynced(state, event.work)

  if (event.type === "stop.requested") return requestStop(state, event)

  if (event.type === "stop.settled" || event.type === "stop.timed-out") return settleStop(state, event)

  if (event.type === "menu.toggled") {
    if (!event.open) return state.status === "closed" ? unchanged(state) : close(state, event.work)

    if (state.status !== "closed" || !event.work.enabled || count(event.work) === 0) return unchanged(state)
    const issued = state.issued + 1

    return changed({ ...state, status: "list", issued, focusAttempt: issued }, [FOCUS_CANCEL])
  }

  if (event.type === "shell.selected") {
    const issued = state.issued + 1
    const base = { issued, focusAttempt: issued, enter: state.enter, stopping: state.stopping }
    const effects: ShellPanelEffect[] = [...leave(state), { type: "focus.back", attempt: issued }]

    // A shell whose Stop is in flight keeps its panel running until the Stop settles, so the panel shows it stopping.
    if (state.stopping[event.item.key] !== undefined || running(event.work, event.item))
      return changed({ ...base, status: "shell", item: event.item, phase: { status: "running" } }, effects)

    return changed({ ...base, status: "shell", item: event.item, phase: { status: "ending", attempt: issued } }, [
      ...effects,
      ...ending(issued, event.item),
    ])
  }

  if (state.status !== "shell") return unchanged(state)

  if (event.type === "back.requested") {
    if (count(event.work) === 0) return close(state, event.work)
    const issued = state.issued + 1

    return changed({ status: "list", issued, focusAttempt: issued, enter: state.enter, stopping: state.stopping }, [
      ...leave(state),
      { type: "focus.row", attempt: issued, key: state.item.key },
    ])
  }

  if (event.type === "ended.settled" || event.type === "ended.timed-out") {
    if (state.phase.status !== "ending" || event.attempt !== state.phase.attempt) return unchanged(state)
    // Removing a running shell ends it as killed, and the server forgets it.
    const info = event.type === "ended.settled" ? event.info : undefined

    return changed(
      {
        ...state,
        phase: {
          status: "ended",
          end: { status: info?.status ?? "killed", exit: info?.exit, completed: info?.completed ?? event.now },
        },
      },
      [{ type: "timer.cancel", attempt: event.attempt }, FOCUS_ENDED],
    )
  }

  return unchanged(state)
}

export function selectShellPanelView(state: ShellPanelState, work: ShellPanelWork) {
  const shell = state.status === "shell" ? state : undefined
  // A shell that ended while its panel is open still counts until the menu closes.
  const held = shell && !running(work, shell.item) ? 1 : 0
  const counts = { subagents: work.subagents.length, shells: work.shells.length + held }
  const phase = shell?.phase.status
  const stoppingKeys = state.status === "disposed" ? NO_STOPS : state.stopping
  const stopping = !!shell && stoppingKeys[shell.item.key] !== undefined

  return {
    counts,
    active: work.enabled && (counts.subagents > 0 || counts.shells > 0),
    open: state.status === "list" || state.status === "shell",
    enter: state.status !== "disposed" && state.enter,
    shell: shell?.item,
    /** Rows whose Stop is in flight. */
    stoppingKeys,
    stopping,
    stopDisabled: stopping || phase === "ending",
    end: shell?.phase.status === "ended" ? shell.phase.end : undefined,
    // Output stops polling once the shell has left the running list; its final read still lands.
    tailRunning: phase === "running",
    clockRunning: state.status === "list" || (!!phase && phase !== "ended"),
  }
}

type Live = Exclude<ShellPanelState, { status: "disposed" }>

function requestStop(state: Live, event: Extract<ShellPanelEvent, { type: "stop.requested" }>) {
  const target = event.item ?? (state.status === "shell" ? state.item : undefined)

  if (!target || state.stopping[target.key] !== undefined || !stoppable(event.work, target)) return unchanged(state)

  // A shown shell that already left the list is ending on its own; stopping it now would report it as stopped.
  if (state.status === "shell" && state.item.key === target.key && state.phase.status !== "running")
    return unchanged(state)
  const issued = state.issued + 1

  return changed({ ...state, issued, stopping: { ...state.stopping, [target.key]: issued } }, [
    { type: "stop.run", attempt: issued, item: target },
    { type: "timer.start", attempt: issued, phase: "stopping" },
  ])
}

function settleStop(state: Live, event: Extract<ShellPanelEvent, { type: "stop.settled" | "stop.timed-out" }>) {
  const key = Object.keys(state.stopping).find((entry) => state.stopping[entry] === event.attempt)

  if (key === undefined) return unchanged(state)
  const stopping = Object.fromEntries(Object.entries(state.stopping).filter(([entry]) => entry !== key))
  const cancel: ShellPanelEffect = { type: "timer.cancel", attempt: event.attempt }

  if (state.status !== "shell" || state.item.key !== key || state.phase.status !== "running")
    return changed({ ...state, stopping }, [cancel])

  if (event.type === "stop.settled" && event.stopped)
    return changed(
      { ...state, stopping, phase: { status: "ended", end: { status: "killed", completed: event.now } } },
      [cancel, FOCUS_ENDED],
    )

  // A Stop that failed leaves the shell running, unless it left the list meanwhile and ends on its own.
  if (running(event.work, state.item)) return changed({ ...state, stopping }, [cancel])
  const issued = state.issued + 1

  return changed({ ...state, issued, stopping, phase: { status: "ending", attempt: issued } }, [
    cancel,
    ...ending(issued, state.item),
  ])
}

function workSynced(state: Live, work: ShellPanelWork) {
  if (state.status === "closed")
    return !active(state, work) && !state.enter ? changed({ ...state, enter: true }) : unchanged(state)

  if (state.status === "list") return active(state, work) ? unchanged(state) : close(state, work)

  if (!work.enabled) return close(state, work)

  // A shell being stopped waits for its Stop to report how it ended.
  if (state.phase.status !== "running" || state.stopping[state.item.key] !== undefined || running(work, state.item))
    return unchanged(state)
  const issued = state.issued + 1

  return changed({ ...state, issued, phase: { status: "ending", attempt: issued } }, ending(issued, state.item))
}

// The menu always opens on the list, and closing forgets the shell so nothing follows it while the menu is shut. With
// nothing left to list, the capsule goes and focus moves to the composer. Stops in flight carry on.
function close(state: Extract<ShellPanelState, { status: "list" | "shell" }>, work: ShellPanelWork) {
  const empty = count(work) === 0
  const issued = state.issued + 1

  return changed(
    {
      status: "closed",
      issued,
      focusAttempt: issued,
      enter: state.enter || empty || !work.enabled,
      stopping: state.stopping,
    },
    [...leave(state), ...(empty ? [FOCUS_EMPTY] : [])],
  )
}

// Leaving a view drops its queued focus move and the shown shell's end lookup.
function leave(state: Live): readonly ShellPanelEffect[] {
  if (state.status === "shell" && state.phase.status === "ending")
    return [{ type: "timer.cancel", attempt: state.phase.attempt }, FOCUS_CANCEL]

  return [FOCUS_CANCEL]
}

function ending(attempt: number, item: SessionActivityItem): readonly ShellPanelEffect[] {
  return [
    { type: "ended.load", attempt, id: item.target },
    { type: "timer.start", attempt, phase: "ending" },
  ]
}

function active(state: Live, work: ShellPanelWork) {
  return selectShellPanelView(state, work).active
}

function running(work: ShellPanelWork, item: SessionActivityItem) {
  return work.shells.some((shell) => shell.key === item.key)
}

function stoppable(work: ShellPanelWork, item: SessionActivityItem) {
  if (item.type === "shell") return running(work, item)

  return work.subagents.some((subagent) => subagent.key === item.key)
}

function count(work: ShellPanelWork) {
  return work.subagents.length + work.shells.length
}

function changed(state: ShellPanelState, effects: readonly ShellPanelEffect[] = NO_EFFECTS): ShellPanelTransition {
  return { state, effects }
}

function unchanged(state: ShellPanelState): ShellPanelTransition {
  return { state, effects: NO_EFFECTS }
}
