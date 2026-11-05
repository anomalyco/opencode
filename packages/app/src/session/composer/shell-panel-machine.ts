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

/** The shown shell. `ending`: it left the running list and the panel waits for how it ended. */
export type ShellPanelPhase =
  | { readonly status: "running" }
  | { readonly status: "stopping" }
  | { readonly status: "ending" }
  | { readonly status: "ended"; readonly end: ShellEnd }

/**
 * The background work menu: shut, open on the list, or open on one shell. A shell that ends while it is shown keeps
 * its panel, with how it ended, until the user goes back or closes the menu. `enter`: the capsule fades in when it
 * next appears, because it was absent once while this composer was mounted.
 */
export type ShellPanelState =
  | { readonly status: "closed"; readonly attempt: number; readonly enter: boolean }
  | { readonly status: "list"; readonly attempt: number; readonly enter: boolean }
  | {
      readonly status: "shell"
      readonly attempt: number
      readonly enter: boolean
      readonly item: SessionActivityItem
      readonly phase: ShellPanelPhase
    }
  | { readonly status: "disposed" }

/** What runs in the background right now. `enabled`: the background activity setting shows the capsule. */
export type ShellPanelWork = {
  readonly enabled: boolean
  readonly subagents: number
  readonly shells: readonly SessionActivityItem[]
}

export type ShellPanelEvent =
  | { readonly type: "work.synced"; readonly work: ShellPanelWork }
  | { readonly type: "menu.toggled"; readonly open: boolean; readonly work: ShellPanelWork }
  | { readonly type: "shell.selected"; readonly item: SessionActivityItem; readonly work: ShellPanelWork }
  | { readonly type: "back.requested"; readonly work: ShellPanelWork }
  | { readonly type: "stop.requested"; readonly work: ShellPanelWork }
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

/** `timer.start` replaces the single pending timer; the `focus.*` effects replace the single pending focus frame. */
export type ShellPanelEffect =
  | { readonly type: "stop.run"; readonly attempt: number; readonly item: SessionActivityItem }
  | { readonly type: "ended.load"; readonly attempt: number; readonly id: string }
  | { readonly type: "timer.start"; readonly attempt: number; readonly phase: "stopping" | "ending" }
  | { readonly type: "timer.cancel" }
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

const TIMER_CANCEL: ShellPanelEffect = Object.freeze({ type: "timer.cancel" })

const FOCUS_CANCEL: ShellPanelEffect = Object.freeze({ type: "focus.cancel" })

const FOCUS_EMPTY: ShellPanelEffect = Object.freeze({ type: "focus.empty" })

const FOCUS_ENDED: ShellPanelEffect = Object.freeze({ type: "focus.ended" })

const DISPOSED: ShellPanelState = Object.freeze({ status: "disposed" })

/** `active`: the capsule already shows on mount, so it stays at rest rather than fading in. */
export function createShellPanelState(input: { active: boolean }): ShellPanelState {
  return { status: "closed", attempt: 0, enter: !input.active }
}

export function transitionShellPanel(state: ShellPanelState, event: ShellPanelEvent): ShellPanelTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return changed(DISPOSED, cleanup(state))

  if (event.type === "work.synced") return workSynced(state, event.work)

  if (event.type === "menu.toggled") {
    if (event.open)
      return state.status === "closed" && event.work.enabled && count(event.work) > 0
        ? changed({ status: "list", attempt: state.attempt + 1, enter: state.enter }, [FOCUS_CANCEL])
        : unchanged(state)

    return state.status === "closed" ? unchanged(state) : close(state, event.work)
  }

  if (event.type === "shell.selected") {
    const attempt = state.attempt + 1
    const focus: ShellPanelEffect = { type: "focus.back", attempt }

    if (running(event.work, event.item))
      return changed({ status: "shell", attempt, enter: state.enter, item: event.item, phase: { status: "running" } }, [
        ...cleanup(state),
        focus,
      ])

    return changed({ status: "shell", attempt, enter: state.enter, item: event.item, phase: { status: "ending" } }, [
      ...cleanup(state),
      focus,
      ...ending(attempt, event.item),
    ])
  }

  if (state.status !== "shell") return unchanged(state)

  if (event.type === "back.requested") {
    if (count(event.work) === 0) return close(state, event.work)

    const attempt = state.attempt + 1

    return changed({ status: "list", attempt, enter: state.enter }, [
      ...cleanup(state),
      { type: "focus.row", attempt, key: state.item.key },
    ])
  }

  if (event.type === "stop.requested") {
    // A shell that already left the list is ending on its own; stopping it now would report it as stopped.
    if (state.phase.status !== "running" || !running(event.work, state.item)) return unchanged(state)
    const attempt = state.attempt + 1

    return changed({ ...state, attempt, phase: { status: "stopping" } }, [
      { type: "stop.run", attempt, item: state.item },
      { type: "timer.start", attempt, phase: "stopping" },
    ])
  }

  if (event.type === "stop.settled" || event.type === "stop.timed-out") {
    if (state.phase.status !== "stopping" || event.attempt !== state.attempt) return unchanged(state)
    const attempt = state.attempt + 1

    if (event.type === "stop.settled" && event.stopped)
      return changed(
        { ...state, attempt, phase: { status: "ended", end: { status: "killed", completed: event.now } } },
        [TIMER_CANCEL, FOCUS_ENDED],
      )

    // A Stop that failed leaves the shell running, unless it left the list meanwhile and ends on its own.
    if (running(event.work, state.item))
      return changed({ ...state, attempt, phase: { status: "running" } }, [TIMER_CANCEL])

    return changed({ ...state, attempt, phase: { status: "ending" } }, [TIMER_CANCEL, ...ending(attempt, state.item)])
  }

  if (event.type === "ended.settled" || event.type === "ended.timed-out") {
    if (state.phase.status !== "ending" || event.attempt !== state.attempt) return unchanged(state)
    // Removing a running shell ends it as killed, and the server forgets it.
    const info = event.type === "ended.settled" ? event.info : undefined

    return changed(
      {
        ...state,
        attempt: state.attempt + 1,
        phase: {
          status: "ended",
          end: { status: info?.status ?? "killed", exit: info?.exit, completed: info?.completed ?? event.now },
        },
      },
      [TIMER_CANCEL, FOCUS_ENDED],
    )
  }

  return unchanged(state)
}

export function selectShellPanelView(state: ShellPanelState, work: ShellPanelWork) {
  const shell = state.status === "shell" ? state : undefined
  // A shell that ended while its panel is open still counts until the menu closes.
  const held = shell && !running(work, shell.item) ? 1 : 0
  const counts = { subagents: work.subagents, shells: work.shells.length + held }
  const phase = shell?.phase.status

  return {
    counts,
    active: work.enabled && (counts.subagents > 0 || counts.shells > 0),
    open: state.status === "list" || state.status === "shell",
    enter: state.status !== "disposed" && state.enter,
    shell: shell?.item,
    stopping: phase === "stopping",
    stopDisabled: phase === "stopping" || phase === "ending",
    end: shell?.phase.status === "ended" ? shell.phase.end : undefined,
    // Output stops polling once the shell has left the running list; its final read still lands.
    tailRunning: phase === "running" || phase === "stopping",
    clockRunning: state.status === "list" || (!!phase && phase !== "ended"),
  }
}

function workSynced(state: Exclude<ShellPanelState, { status: "disposed" }>, work: ShellPanelWork) {
  if (state.status === "closed")
    return !active(state, work) && !state.enter ? changed({ ...state, enter: true }) : unchanged(state)

  if (state.status === "list") return active(state, work) ? unchanged(state) : close(state, work)

  if (!work.enabled) return close(state, work)

  if (state.phase.status !== "running" || running(work, state.item)) return unchanged(state)
  const attempt = state.attempt + 1

  return changed({ ...state, attempt, phase: { status: "ending" } }, ending(attempt, state.item))
}

// The menu always opens on the list, and closing forgets the shell so nothing follows it while the menu is shut. With
// nothing left to list, the capsule goes and focus moves to the composer.
function close(state: Extract<ShellPanelState, { status: "list" | "shell" }>, work: ShellPanelWork) {
  const empty = count(work) === 0

  return changed({ status: "closed", attempt: state.attempt + 1, enter: state.enter || empty || !work.enabled }, [
    ...cleanup(state),
    ...(empty ? [FOCUS_EMPTY] : []),
  ])
}

function cleanup(state: Exclude<ShellPanelState, { status: "disposed" }>): readonly ShellPanelEffect[] {
  if (state.status === "shell" && (state.phase.status === "stopping" || state.phase.status === "ending"))
    return [TIMER_CANCEL, FOCUS_CANCEL]

  return [FOCUS_CANCEL]
}

function ending(attempt: number, item: SessionActivityItem): readonly ShellPanelEffect[] {
  return [
    { type: "ended.load", attempt, id: item.target },
    { type: "timer.start", attempt, phase: "ending" },
  ]
}

function active(state: Exclude<ShellPanelState, { status: "disposed" }>, work: ShellPanelWork) {
  return selectShellPanelView(state, work).active
}

function running(work: ShellPanelWork, item: SessionActivityItem) {
  return work.shells.some((shell) => shell.key === item.key)
}

function count(work: ShellPanelWork) {
  return work.subagents + work.shells.length
}

function changed(state: ShellPanelState, effects: readonly ShellPanelEffect[] = NO_EFFECTS): ShellPanelTransition {
  return { state, effects }
}

function unchanged(state: ShellPanelState): ShellPanelTransition {
  return { state, effects: NO_EFFECTS }
}
