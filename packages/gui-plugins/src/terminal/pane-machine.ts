import type { TerminalFailure, TerminalSize } from "./connection"

/** How long loading ghostty-web and its WASM binary may take before the pane fails. */
export const GHOSTTY_LOAD_TIMEOUT_MS = 30_000

/** How long fetching the snapshot, minting the ticket and opening the socket may take before the pane fails. */
export const TERMINAL_CONNECT_TIMEOUT_MS = 15_000

/** How long a resize after the first measurement waits before the pane asks for it. */
export const TERMINAL_SIZE_DEBOUNCE_MS = 100

/**
 * The size this attachment asks the PTY for. `size` is the last one asked for, undefined while the pane has not
 * measured yet (it was hidden when it opened). `pending` waits out the resize debounce; `seq` names it, so an older
 * timer is ignored.
 */
export type PaneSizing = {
  readonly seq: number
  readonly size: TerminalSize | undefined
  readonly pending: TerminalSize | undefined
}

/**
 * One `<Terminal>` mount, which attaches to one PTY once and only moves forward. `T` is the opened ghostty-web
 * `Terminal`. `opening` builds the emulator; `connecting` restores the snapshot and opens the socket, and shows once
 * it wrote the screen (`shown`). `failed` keeps the last screen, when there is one, under the reason until unmount.
 */
export type PaneState<T> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "opening" }
  | { readonly status: "connecting"; readonly term: T; readonly sizing: PaneSizing; readonly shown: boolean }
  | { readonly status: "live"; readonly term: T; readonly sizing: PaneSizing }
  | { readonly status: "failed"; readonly failure: TerminalFailure; readonly term: T | undefined }
  | { readonly status: "disposed" }

export type PaneEvent<L, T> =
  | { readonly type: "mounted" }
  | { readonly type: "ghostty.loaded"; readonly loaded: L }
  | { readonly type: "ghostty.failed" }
  /** The emulator opened in the pane; `initialSize` is its first measurement, undefined while the pane is hidden. */
  | { readonly type: "terminal.opened"; readonly term: T; readonly initialSize: TerminalSize | undefined }
  /** The emulator wrote output for the first time. */
  | { readonly type: "screen.written" }
  | { readonly type: "socket.opened" }
  /** The emulator could not open, or the snapshot, ticket, socket or protocol check failed, or the socket closed. */
  | { readonly type: "connection.failed"; readonly failure: TerminalFailure }
  | { readonly type: "phase.timed-out"; readonly phase: "loading" | "connecting" }
  /** The container, window, font or zoom changed, so the pane measures again on the next frame. */
  | { readonly type: "measure.requested" }
  /** The frame's measurement; undefined while the pane is hidden. */
  | { readonly type: "measure.sampled"; readonly proposed: TerminalSize | undefined }
  | { readonly type: "size.debounced"; readonly seq: number }
  | { readonly type: "disposed" }

export type PaneEffect<L> =
  /** Loads ghostty-web, and times out as `phase.timed-out` `loading`. */
  | { readonly type: "load-ghostty"; readonly timeoutMs: number }
  | { readonly type: "cancel-phase-timer" }
  /** Builds and opens the emulator, then reports `terminal.opened` synchronously. */
  | { readonly type: "open-terminal"; readonly loaded: L }
  /** Restores the snapshot and opens the socket, and times out as `phase.timed-out` `connecting`. */
  | { readonly type: "start-connect"; readonly timeoutMs: number }
  | { readonly type: "apply-size"; readonly size: TerminalSize }
  /** Measures on the next frame, unless a frame is already queued. */
  | { readonly type: "schedule-measure" }
  /** Replaces the resize debounce timer. */
  | { readonly type: "schedule-size-timer"; readonly seq: number; readonly delayMs: number }
  | { readonly type: "cancel-size-timer" }
  /** Cancels the phase timer and measurement, aborts the connect attempt and closes its socket; keeps the emulator. */
  | { readonly type: "stop" }
  /** Tells the panel, once per mount, that this pane failed (`props.onFailure`). */
  | { readonly type: "notify-failure" }
  /** Stops, then disposes the emulator, its listeners and focus timers. */
  | { readonly type: "release" }

export type PaneTransition<L, T> = {
  readonly state: PaneState<T>
  readonly effects: readonly PaneEffect<L>[]
}

const NONE: readonly never[] = []

const MEASURE: readonly PaneEffect<never>[] = [{ type: "schedule-measure" }]

const CANCEL_SIZE: readonly PaneEffect<never>[] = [{ type: "cancel-size-timer" }]

const FAIL: readonly PaneEffect<never>[] = [{ type: "stop" }, { type: "notify-failure" }]

const RELEASE_AND_FAIL: readonly PaneEffect<never>[] = [{ type: "release" }, { type: "notify-failure" }]

const RELEASE: readonly PaneEffect<never>[] = [{ type: "release" }]

export const initialPaneState: PaneState<never> = { status: "idle" }

/**
 * The pane loads ghostty-web, opens the emulator, then restores the snapshot and opens the socket. It shows once it
 * wrote the screen, the socket opened, or it failed, so a silent terminal with an empty screen still shows. Loading
 * and connecting are bounded by a timeout. Failing stops everything in flight and tells the panel once; unmounting
 * releases everything and tells nobody.
 */
export function transitionPane<L, T>(state: PaneState<T>, event: PaneEvent<L, T>): PaneTransition<L, T> {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return { state: { status: "disposed" }, effects: state.status === "idle" ? NONE : RELEASE }

  if (state.status === "idle") {
    if (event.type !== "mounted") return { state, effects: NONE }

    return { state: { status: "loading" }, effects: [{ type: "load-ghostty", timeoutMs: GHOSTTY_LOAD_TIMEOUT_MS }] }
  }

  if (state.status === "loading") {
    if (event.type === "ghostty.loaded")
      return {
        state: { status: "opening" },
        effects: [{ type: "cancel-phase-timer" }, { type: "open-terminal", loaded: event.loaded }],
      }

    if (event.type === "ghostty.failed" || (event.type === "phase.timed-out" && event.phase === "loading"))
      return { state: failed<T>("failed", undefined), effects: FAIL }

    return { state, effects: NONE }
  }

  if (state.status === "opening") {
    if (event.type === "terminal.opened") {
      const connect: PaneEffect<L> = { type: "start-connect", timeoutMs: TERMINAL_CONNECT_TIMEOUT_MS }

      return {
        state: {
          status: "connecting",
          term: event.term,
          sizing: { seq: 0, size: event.initialSize, pending: undefined },
          shown: false,
        },
        effects: event.initialSize ? [{ type: "apply-size", size: event.initialSize }, connect] : [connect],
      }
    }

    // The emulator may have opened partway; nothing of it stays.
    if (event.type === "connection.failed")
      return { state: failed<T>(event.failure, undefined), effects: RELEASE_AND_FAIL }

    return { state, effects: NONE }
  }

  if (state.status === "failed") return { state, effects: NONE }

  if (event.type === "connection.failed") return { state: failed(event.failure, state.term), effects: FAIL }

  if (event.type === "measure.requested") return { state, effects: MEASURE }

  if (event.type === "measure.sampled") return sampled(state, event.proposed)

  if (event.type === "size.debounced") {
    const sizing = state.sizing

    if (!sizing.pending || sizing.seq !== event.seq) return { state, effects: NONE }

    return {
      state: { ...state, sizing: { seq: sizing.seq, size: sizing.pending, pending: undefined } },
      effects: [{ type: "apply-size", size: sizing.pending }],
    }
  }

  if (state.status === "live") return { state, effects: NONE }

  if (event.type === "screen.written")
    return state.shown ? { state, effects: NONE } : { state: { ...state, shown: true }, effects: NONE }

  if (event.type === "socket.opened")
    return {
      state: { status: "live", term: state.term, sizing: state.sizing },
      effects: [{ type: "cancel-phase-timer" }],
    }

  if (event.type === "phase.timed-out" && event.phase === "connecting")
    return { state: failed("failed", state.term), effects: FAIL }

  return { state, effects: NONE }
}

/** Whether the pane shows; until then it is transparent, so an empty emulator never flashes before the screen. */
export function paneRevealed<T>(state: PaneState<T>) {
  if (state.status === "connecting") return state.shown

  return state.status === "live" || state.status === "failed"
}

/** Why the pane failed, for its banner. */
export function paneFailure<T>(state: PaneState<T>) {
  return state.status === "failed" ? state.failure : undefined
}

/** The opened emulator, also after a failure so the last screen stays readable and selectable. */
export function paneTerm<T>(state: PaneState<T>) {
  return state.status === "connecting" || state.status === "live" || state.status === "failed" ? state.term : undefined
}

/** The event a throwing effect reports, so the pane fails instead of waiting forever. */
export function paneEffectFailed<L>(effect: PaneEffect<L>): PaneEvent<L, never> | undefined {
  if (effect.type === "load-ghostty") return { type: "ghostty.failed" }

  if (effect.type === "open-terminal" || effect.type === "start-connect")
    return { type: "connection.failed", failure: "failed" }
}

/**
 * The pane's driver loop: applies one event at a time and runs its effects. An effect may dispatch synchronously; its
 * event waits until the current one has applied. A throwing effect reports `paneEffectFailed(effect)`, and nothing
 * that throws stalls the queue.
 */
export function createPaneDispatch<L, T>(driver: {
  readonly read: () => PaneState<T>
  readonly write: (state: PaneState<T>) => void
  readonly run: (effect: PaneEffect<L>) => void
}) {
  const queue: PaneEvent<L, T>[] = []

  const apply = (event: PaneEvent<L, T>) => {
    const next = transitionPane(driver.read(), event)

    driver.write(next.state)
    next.effects.forEach((effect) => {
      void Promise.try(() => driver.run(effect)).catch((cause: unknown) => {
        const failure = paneEffectFailed(effect)

        if (!failure) throw cause
        dispatch(failure)
      })
    })
  }

  const dispatch = (event: PaneEvent<L, T>) => {
    queue.push(event)

    if (queue.length > 1) return

    while (queue.length > 0) {
      void Promise.try(apply, queue[0])
      queue.shift()
    }
  }

  return dispatch
}

function failed<T>(failure: TerminalFailure, term: T | undefined): PaneState<T> {
  return { status: "failed", failure, term }
}

function sampled<L, T>(
  state: Extract<PaneState<T>, { status: "connecting" | "live" }>,
  proposed: TerminalSize | undefined,
): PaneTransition<L, T> {
  const sizing = state.sizing

  // Hidden, or back at the size already asked for: a pending resize no longer applies.
  if (!proposed || same(proposed, sizing.size)) {
    if (!sizing.pending) return { state, effects: NONE }

    return { state: { ...state, sizing: { ...sizing, pending: undefined } }, effects: CANCEL_SIZE }
  }

  // The first measurement applies at once; nothing is pending before it.
  if (!sizing.size)
    return {
      state: { ...state, sizing: { seq: sizing.seq, size: proposed, pending: undefined } },
      effects: [{ type: "apply-size", size: proposed }],
    }

  if (same(proposed, sizing.pending)) return { state, effects: NONE }

  const seq = sizing.seq + 1

  return {
    state: { ...state, sizing: { seq, size: sizing.size, pending: proposed } },
    effects: [{ type: "schedule-size-timer", seq, delayMs: TERMINAL_SIZE_DEBOUNCE_MS }],
  }
}

function same(a: TerminalSize, b: TerminalSize | undefined) {
  return a.cols === b?.cols && a.rows === b.rows
}
