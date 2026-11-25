import { describe, expect, test } from "bun:test"
import {
  createPaneDispatch,
  GHOSTTY_LOAD_TIMEOUT_MS,
  initialPaneState,
  paneFailure,
  paneRevealed,
  paneTerm,
  TERMINAL_CONNECT_TIMEOUT_MS,
  TERMINAL_SIZE_DEBOUNCE_MS,
  transitionPane,
  type PaneEffect,
  type PaneEvent,
  type PaneState,
  type PaneTransition,
} from "./pane-machine"

type Loaded = { readonly ghostty: string }

type Term = { readonly id: string }

const LOADED: Loaded = { ghostty: "wasm" }

const TERM: Term = { id: "term" }

const SIZE = { cols: 90, rows: 28 }

type Event = PaneEvent<Loaded, Term>

// Folds the events in order and returns the last transition.
const replay = (events: readonly Event[], state: PaneState<Term> = initialPaneState) =>
  events.reduce<PaneTransition<Loaded, Term>>((last, event) => transitionPane(last.state, event), {
    state,
    effects: [],
  })

const loading: Event[] = [{ type: "mounted" }]

const opening: Event[] = [...loading, { type: "ghostty.loaded", loaded: LOADED }]

const connecting: Event[] = [...opening, { type: "terminal.opened", term: TERM, initialSize: SIZE }]

const live: Event[] = [...connecting, { type: "socket.opened" }]

const sampled = (proposed: { cols: number; rows: number } | undefined): Event => ({ type: "measure.sampled", proposed })

describe("terminal pane machine", () => {
  test("a silent terminal with an empty screen shows once its socket opens", () => {
    const opened = replay(connecting)

    expect(opened.state.status).toBe("connecting")
    expect(paneRevealed(opened.state)).toBe(false)

    // The snapshot's checkpoint is empty and the shell prints nothing: no write ever reaches the emulator.
    const next = replay(live)

    expect(next.state).toEqual({ status: "live", term: TERM, sizing: { seq: 0, size: SIZE, pending: undefined } })
    expect(next.effects).toEqual([{ type: "cancel-phase-timer" }])
    expect(paneRevealed(next.state)).toBe(true)
  })

  test("the restored screen shows before the socket opens", () => {
    const written = replay([...connecting, { type: "screen.written" }])

    expect(written.state.status).toBe("connecting")
    expect(paneRevealed(written.state)).toBe(true)
    expect(replay([{ type: "screen.written" }], written.state).state).toBe(written.state)
  })

  test("loads, opens, then connects at the first size", () => {
    const mounted = replay(loading)

    expect(mounted.state).toEqual({ status: "loading" })
    expect(mounted.effects).toEqual([{ type: "load-ghostty", timeoutMs: GHOSTTY_LOAD_TIMEOUT_MS }])

    const loaded = replay(opening)

    expect(loaded.state).toEqual({ status: "opening" })
    expect(loaded.effects).toEqual([{ type: "cancel-phase-timer" }, { type: "open-terminal", loaded: LOADED }])

    // The size goes out before the connect starts, so the replay's end can take control at it.
    const opened = replay(connecting)

    expect(opened.effects).toEqual([
      { type: "apply-size", size: SIZE },
      { type: "start-connect", timeoutMs: TERMINAL_CONNECT_TIMEOUT_MS },
    ])
    expect(paneTerm(opened.state)).toBe(TERM)
  })

  test("a failure stops the socket and the connect attempt, tells the panel once, and keeps the screen", () => {
    const failed = replay([...live, { type: "connection.failed", failure: "failed" }])

    expect(failed.state).toEqual({ status: "failed", failure: "failed", term: TERM })
    expect(failed.effects).toEqual([{ type: "stop" }, { type: "notify-failure" }])
    expect(paneRevealed(failed.state)).toBe(true)
    expect(paneFailure(failed.state)).toBe("failed")
    expect(paneTerm(failed.state)).toBe(TERM)

    const late: Event[] = [
      { type: "connection.failed", failure: "disconnected" },
      { type: "socket.opened" },
      { type: "phase.timed-out", phase: "connecting" },
      { type: "measure.requested" },
      sampled({ cols: 100, rows: 30 }),
      { type: "size.debounced", seq: 1 },
      { type: "screen.written" },
    ]

    late.forEach((event) => {
      const next = transitionPane(failed.state, event)

      expect(next.state).toBe(failed.state)
      expect(next.effects).toEqual([])
    })

    // A connect attempt that fails before its socket opens stops the same way.
    const early = replay([...connecting, { type: "connection.failed", failure: "outdated" }])

    expect(early.state).toEqual({ status: "failed", failure: "outdated", term: TERM })
    expect(early.effects).toEqual([{ type: "stop" }, { type: "notify-failure" }])
  })

  test("loading and connecting time out into a failure", () => {
    const loadTimeout = replay([...loading, { type: "phase.timed-out", phase: "loading" }])

    expect(loadTimeout.state).toEqual({ status: "failed", failure: "failed", term: undefined })
    expect(loadTimeout.effects).toEqual([{ type: "stop" }, { type: "notify-failure" }])
    expect(paneRevealed(loadTimeout.state)).toBe(true)

    // ghostty-web arriving after the timeout never builds an emulator.
    const late = transitionPane(loadTimeout.state, { type: "ghostty.loaded", loaded: LOADED })

    expect(late.state).toBe(loadTimeout.state)
    expect(late.effects).toEqual([])

    const connectTimeout = replay([...connecting, { type: "phase.timed-out", phase: "connecting" }])

    expect(connectTimeout.state).toEqual({ status: "failed", failure: "failed", term: TERM })
    expect(connectTimeout.effects).toEqual([{ type: "stop" }, { type: "notify-failure" }])
    expect(transitionPane(connectTimeout.state, { type: "socket.opened" }).state).toBe(connectTimeout.state)

    // A timer of an earlier phase that fires late is ignored.
    const stale: [Event[], Event][] = [
      [connecting, { type: "phase.timed-out", phase: "loading" }],
      [live, { type: "phase.timed-out", phase: "loading" }],
      [live, { type: "phase.timed-out", phase: "connecting" }],
      [loading, { type: "phase.timed-out", phase: "connecting" }],
    ]

    stale.forEach(([events, event]) => {
      const state = replay(events).state
      const next = transitionPane(state, event)

      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    })
  })

  test("a failed load or open shows the failure without a screen", () => {
    const load = replay([...loading, { type: "ghostty.failed" }])

    expect(load.state).toEqual({ status: "failed", failure: "failed", term: undefined })
    expect(load.effects).toEqual([{ type: "stop" }, { type: "notify-failure" }])

    // The emulator may have opened partway, so it is released.
    const open = replay([...opening, { type: "connection.failed", failure: "failed" }])

    expect(open.state).toEqual({ status: "failed", failure: "failed", term: undefined })
    expect(open.effects).toEqual([{ type: "release" }, { type: "notify-failure" }])
    expect(paneTerm(open.state)).toBeUndefined()
  })

  test("a pane hidden when it opened applies its first measurement at once", () => {
    const opened = replay([...opening, { type: "terminal.opened", term: TERM, initialSize: undefined }])

    expect(opened.effects).toEqual([{ type: "start-connect", timeoutMs: TERMINAL_CONNECT_TIMEOUT_MS }])

    const requested = transitionPane(opened.state, { type: "measure.requested" })

    expect(requested.state).toBe(opened.state)
    expect(requested.effects).toEqual([{ type: "schedule-measure" }])

    // Still hidden.
    expect(transitionPane(opened.state, sampled(undefined)).state).toBe(opened.state)

    const shown = transitionPane(opened.state, sampled(SIZE))

    expect(shown.effects).toEqual([{ type: "apply-size", size: SIZE }])
    expect(transitionPane(shown.state, sampled(SIZE))).toEqual({ state: shown.state, effects: [] })
  })

  test("a resize waits out the debounce, and hiding or bouncing back cancels it", () => {
    const wider = { cols: 110, rows: 32 }
    const resized = replay([...live, sampled(wider)])

    expect(resized.effects).toEqual([{ type: "schedule-size-timer", seq: 1, delayMs: TERMINAL_SIZE_DEBOUNCE_MS }])

    // The same pending size again keeps its timer.
    expect(transitionPane(resized.state, sampled(wider))).toEqual({ state: resized.state, effects: [] })

    const applied = transitionPane(resized.state, { type: "size.debounced", seq: 1 })

    expect(applied.effects).toEqual([{ type: "apply-size", size: wider }])
    expect(applied.state).toMatchObject({ sizing: { seq: 1, size: wider, pending: undefined } })

    // The tab hides while the resize waits: nothing goes out, even when the timer fires.
    const hidden = transitionPane(resized.state, sampled(undefined))

    expect(hidden.effects).toEqual([{ type: "cancel-size-timer" }])
    expect(transitionPane(hidden.state, { type: "size.debounced", seq: 1 })).toEqual({
      state: hidden.state,
      effects: [],
    })

    const bounced = transitionPane(resized.state, sampled(SIZE))

    expect(bounced.effects).toEqual([{ type: "cancel-size-timer" }])
    expect(transitionPane(bounced.state, { type: "size.debounced", seq: 1 }).effects).toEqual([])
  })

  test("only the last resize's timer applies", () => {
    const wider = { cols: 110, rows: 32 }
    const widest = { cols: 120, rows: 35 }
    const resized = replay([...live, sampled(wider), sampled(widest), sampled(wider)])

    expect(resized.effects).toEqual([{ type: "schedule-size-timer", seq: 3, delayMs: TERMINAL_SIZE_DEBOUNCE_MS }])
    expect(transitionPane(resized.state, { type: "size.debounced", seq: 1 }).state).toBe(resized.state)
    expect(transitionPane(resized.state, { type: "size.debounced", seq: 2 }).state).toBe(resized.state)
    expect(transitionPane(resized.state, { type: "size.debounced", seq: 3 }).effects).toEqual([
      { type: "apply-size", size: wider },
    ])
  })

  test("measurement waits for the emulator and stops with the pane", () => {
    const states = [
      initialPaneState,
      replay(loading).state,
      replay(opening).state,
      replay([...live, { type: "connection.failed", failure: "disconnected" }]).state,
      replay([...live, { type: "disposed" }]).state,
    ]

    states.forEach((state) => {
      const next = transitionPane<Loaded, Term>(state, { type: "measure.requested" })

      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    })
  })

  test("unmounting from any phase releases everything and tells nobody", () => {
    const phases: Event[][] = [
      [],
      loading,
      opening,
      connecting,
      live,
      [...live, { type: "connection.failed", failure: "failed" }],
    ]

    phases.forEach((events) => {
      const disposed = replay([...events, { type: "disposed" }])

      expect(disposed.state).toEqual({ status: "disposed" })
      expect(disposed.effects).toEqual(events.length === 0 ? [] : [{ type: "release" }])
      expect(paneRevealed(disposed.state)).toBe(false)

      const after: Event[] = [
        { type: "mounted" },
        { type: "ghostty.loaded", loaded: LOADED },
        { type: "ghostty.failed" },
        { type: "terminal.opened", term: TERM, initialSize: SIZE },
        { type: "socket.opened" },
        { type: "connection.failed", failure: "failed" },
        { type: "phase.timed-out", phase: "connecting" },
        { type: "disposed" },
      ]

      after.forEach((event) => {
        const next = transitionPane(disposed.state, event)

        expect(next.state).toBe(disposed.state)
        expect(next.effects).toEqual([])
      })
    })
  })

  test("the driver applies events an effect dispatches after the current one, and fails a throwing open", async () => {
    const order: string[] = []
    let current: PaneState<Term> = initialPaneState

    const dispatch = createPaneDispatch<Loaded, Term>({
      read: () => current,
      write: (next) => {
        order.push(`state:${next.status}`)
        current = next
      },
      run: (effect: PaneEffect<Loaded>) => {
        order.push(`effect:${effect.type}`)

        if (effect.type === "load-ghostty") dispatch({ type: "ghostty.loaded", loaded: LOADED })

        if (effect.type === "open-terminal") throw new Error("WebGL context lost")
      },
    })

    dispatch({ type: "mounted" })

    expect(order).toEqual([
      "state:loading",
      "effect:load-ghostty",
      "state:opening",
      "effect:cancel-phase-timer",
      "effect:open-terminal",
    ])

    await Promise.resolve()
    await Promise.resolve()

    expect(current).toEqual({ status: "failed", failure: "failed", term: undefined })
    expect(order.slice(5)).toEqual(["state:failed", "effect:release", "effect:notify-failure"])

    // The queue still advances.
    dispatch({ type: "disposed" })

    expect(current).toEqual({ status: "disposed" })
  })
})
