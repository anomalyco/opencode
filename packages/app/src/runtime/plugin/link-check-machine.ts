/** A check asked while its timeline was hidden, or one that came back negative while hidden. */
export type WaitingLinkCheck = { readonly id: number; readonly href: string }

/** A check whose answer is on its way; `epoch` is the selection it was asked in. */
export type RunningLinkCheck = { readonly id: number; readonly href: string; readonly epoch: number }

/**
 * Link checks for one timeline. `epoch` counts the times the timeline was hidden, so a negative answer to a check
 * asked before the latest hide is a false negative and is asked again. `id` names one caller's request across retries.
 */
export type LinkCheckState =
  /** Selected: checks run now. Waiting checks run on the wake scheduled when the timeline was selected. */
  | {
      readonly status: "active"
      readonly epoch: number
      readonly nextId: number
      readonly waiting: readonly WaitingLinkCheck[]
      readonly running: readonly RunningLinkCheck[]
    }
  /** Hidden: new checks wait, and a negative answer waits to be asked again. */
  | {
      readonly status: "hidden"
      readonly epoch: number
      readonly nextId: number
      readonly waiting: readonly WaitingLinkCheck[]
      readonly running: readonly RunningLinkCheck[]
    }
  /** The timeline's owner went away: every request answered `false`. */
  | { readonly status: "disposed" }

export type LinkCheckEvent =
  | { readonly type: "sync"; readonly active: boolean }
  /** The microtask after the timeline was selected in `epoch`, once the routed session has settled. */
  | { readonly type: "wake"; readonly epoch: number }
  /** A check asked while hidden. */
  | { readonly type: "defer"; readonly href: string }
  /** A check the driver already asked while selected, whose answer is a promise. */
  | { readonly type: "start"; readonly href: string }
  | { readonly type: "settled"; readonly id: number; readonly found: boolean }
  | { readonly type: "failed"; readonly id: number; readonly cause: unknown }
  | { readonly type: "disposed" }

export type LinkCheckEffect =
  | { readonly type: "schedule.wake"; readonly epoch: number }
  | { readonly type: "check"; readonly id: number; readonly href: string }
  | { readonly type: "resolve"; readonly id: number; readonly value: boolean }
  | { readonly type: "reject"; readonly id: number; readonly cause: unknown }

export type LinkCheckTransition = {
  readonly state: LinkCheckState
  readonly effects: readonly LinkCheckEffect[]
  /** The request a `defer` or `start` event added. */
  readonly id?: number
}

export function createLinkCheckState(active: boolean): LinkCheckState {
  return { status: active ? "active" : "hidden", epoch: 0, nextId: 0, waiting: [], running: [] }
}

export function transitionLinkCheck(state: LinkCheckState, event: LinkCheckEvent): LinkCheckTransition {
  if (state.status === "disposed") return step(state)

  if (event.type === "disposed")
    return step(
      { status: "disposed" },
      [...state.waiting, ...state.running].map((item) => ({ type: "resolve", id: item.id, value: false })),
    )

  if (event.type === "sync") {
    if (event.active === (state.status === "active")) return step(state)

    if (!event.active) return step({ ...state, status: "hidden", epoch: state.epoch + 1 })

    return step(
      { ...state, status: "active" },
      state.waiting.length > 0 ? [{ type: "schedule.wake", epoch: state.epoch }] : [],
    )
  }

  if (event.type === "wake") {
    if (state.status !== "active" || event.epoch !== state.epoch || state.waiting.length === 0) return step(state)
    const woken = state.waiting.map((item) => ({ id: item.id, href: item.href, epoch: state.epoch }))

    return step(
      { ...state, waiting: [], running: [...state.running, ...woken] },
      woken.map((item) => ({ type: "check", id: item.id, href: item.href })),
    )
  }

  if (event.type === "defer") {
    const id = state.nextId + 1
    const wake = state.status === "active" && state.waiting.length === 0

    return {
      state: { ...state, nextId: id, waiting: [...state.waiting, { id, href: event.href }] },
      effects: wake ? [{ type: "schedule.wake", epoch: state.epoch }] : [],
      id,
    }
  }

  if (event.type === "start") {
    const id = state.nextId + 1

    return {
      state: { ...state, nextId: id, running: [...state.running, { id, href: event.href, epoch: state.epoch }] },
      effects: [],
      id,
    }
  }

  const entry = state.running.find((item) => item.id === event.id)

  if (!entry) return step(state)
  const running = state.running.filter((item) => item !== entry)

  if (event.type === "failed") return step({ ...state, running }, [{ type: "reject", id: entry.id, cause: event.cause }])

  if (event.found || (state.status === "active" && entry.epoch === state.epoch))
    return step({ ...state, running }, [{ type: "resolve", id: entry.id, value: event.found }])

  // A negative answer from a check asked before the timeline was last hidden may be a false negative.
  if (state.status === "hidden")
    return step({ ...state, running, waiting: [...state.waiting, { id: entry.id, href: entry.href }] })

  return step({ ...state, running: [...running, { id: entry.id, href: entry.href, epoch: state.epoch }] }, [
    { type: "check", id: entry.id, href: entry.href },
  ])
}

export function selectLinkCheckDisposed(state: LinkCheckState) {
  return state.status === "disposed"
}

/** Checks run now only while the timeline is selected. */
export function selectLinkCheckActive(state: LinkCheckState) {
  return state.status === "active"
}

function step(state: LinkCheckState, effects: readonly LinkCheckEffect[] = []): LinkCheckTransition {
  return { state, effects }
}
