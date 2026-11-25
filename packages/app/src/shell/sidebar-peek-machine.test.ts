import { describe, expect, test } from "bun:test"
import {
  DISPOSED_SIDEBAR_PEEK_STATE,
  INITIAL_SIDEBAR_PEEK_STATE,
  PEEK_BLUR_EVENT,
  PEEK_DISABLED_EVENT,
  PEEK_DISPOSED_EVENT,
  PEEK_DOCK_CLOSED_EVENT,
  PEEK_DOCK_OPENED_EVENT,
  PEEK_ESCAPE_EVENT,
  PEEK_FOCUS_LEFT_EVENT,
  PEEK_INTERRUPT_EVENT,
  PEEK_TOGGLE_LEAVE_EVENT,
  samplePointerEvent,
  selectPeekHandedOff,
  selectPeekShown,
  sidebarPeekEffects,
  toggleEnterEvent,
  transitionSidebarPeek,
  type SidebarPeekEffect,
  type SidebarPeekEvent,
  type SidebarPeekState,
} from "./sidebar-peek-machine"

// Folds events the way the driver does, keeping each step's state and effects.
function replay(events: SidebarPeekEvent[], state: SidebarPeekState = INITIAL_SIDEBAR_PEEK_STATE) {
  return events.reduce<{ state: SidebarPeekState; effects: unknown[][] }>(
    (acc, event) => {
      const next = transitionSidebarPeek(acc.state, event)

      return { state: next, effects: [...acc.effects, [...sidebarPeekEffects(acc.state, next)]] }
    },
    { state, effects: [] },
  )
}

const edge = samplePointerEvent(true, false)

const away = samplePointerEvent(false, false)

const keep = samplePointerEvent(false, true)

const peeking = () => replay([edge, { type: "dwell.elapsed", attempt: 1, ready: true }]).state

describe("sidebar peek", () => {
  test("a rested edge peeks, and leaving the corridor closes it after the grace", () => {
    const result = replay([
      edge,
      { type: "dwell.elapsed", attempt: 1, ready: true },
      away,
      { type: "grace.elapsed", attempt: 2, keepOpen: false },
      { type: "leave.settled", attempt: 3 },
    ])

    expect(result.effects).toEqual([
      [{ type: "dwell.start", from: "edge", attempt: 1, delayMs: 40 }],
      [{ type: "dwell.clear" }, { type: "watch.start", intervalMs: 150 }, { type: "spring.open" }],
      [{ type: "grace.start", attempt: 2, delayMs: 100 }],
      [
        { type: "grace.clear" },
        { type: "watch.stop" },
        { type: "focus.evict", restoreToggle: false },
        { type: "spring.close", attempt: 3, timeoutMs: 800 },
      ],
      [{ type: "leave.clear" }, { type: "peek.reset" }],
    ])
    expect(result.state).toEqual({ status: "idle", attempt: 3 })
  })

  test("a dock from a peek hands off, and ends the hand-off once it lands", () => {
    const docked = replay([PEEK_DOCK_OPENED_EVENT], peeking())
    expect(selectPeekHandedOff(docked.state)).toBe(true)
    expect(docked.effects).toEqual([
      [{ type: "watch.stop" }, { type: "spring.open" }, { type: "handoff.await", attempt: 2, timeoutMs: 1_000 }],
    ])

    const landed = replay([{ type: "dock.settled", attempt: 2 }], docked.state)
    expect(landed.state).toEqual({ status: "idle", attempt: 2 })
    expect(selectPeekHandedOff(landed.state)).toBe(false)
    expect(selectPeekShown(landed.state)).toBe(false)
    expect(landed.effects).toEqual([[{ type: "handoff.clear" }, { type: "peek.reset" }]])
  })

  test("the toggle can't reopen a peek while it docks, or while a reversed dock still closes", () => {
    const docking = transitionSidebarPeek(peeking(), PEEK_DOCK_OPENED_EVENT)
    expect(transitionSidebarPeek(docking, toggleEnterEvent(true))).toBe(docking)
    expect(transitionSidebarPeek(docking, toggleEnterEvent(false))).toBe(docking)

    // The docked sidebar is still closing, so no peek is available.
    const reversed = transitionSidebarPeek(docking, PEEK_DOCK_CLOSED_EVENT)
    expect(reversed).toEqual({ status: "leaving", attempt: 3, restoreFocus: false })
    expect(transitionSidebarPeek(reversed, toggleEnterEvent(false))).toBe(reversed)
    expect(transitionSidebarPeek(reversed, edge)).toEqual({ status: "peeking", attempt: 4 })
  })

  test("a blur or Escape cancels a pending dwell, so its timer can't peek a backgrounded window", () => {
    for (const from of ["edge", "toggle"] as const) {
      for (const event of [PEEK_BLUR_EVENT, PEEK_ESCAPE_EVENT]) {
        const result = replay([event], { status: "dwelling", from, attempt: 1 })
        expect(result.state).toEqual({ status: "idle", attempt: 1 })
        expect(result.effects).toEqual([[{ type: "dwell.clear" }]])
        expect(transitionSidebarPeek(result.state, { type: "dwell.elapsed", attempt: 1, ready: true })).toBe(
          result.state,
        )
      }
    }
  })

  test("losing the vertical sidebar ends every phase at once", () => {
    const cases: [SidebarPeekState, SidebarPeekEffect[]][] = [
      [{ status: "dwelling", from: "edge", attempt: 1 }, [{ type: "dwell.clear" }]],
      [{ status: "peeking", attempt: 1 }, [{ type: "watch.stop" }, { type: "peek.reset" }]],
      [{ status: "grace", attempt: 1 }, [{ type: "grace.clear" }, { type: "watch.stop" }, { type: "peek.reset" }]],
      [{ status: "leaving", attempt: 1, restoreFocus: false }, [{ type: "leave.clear" }, { type: "peek.reset" }]],
      [{ status: "handing-off", attempt: 1 }, [{ type: "handoff.clear" }, { type: "peek.reset" }]],
    ]

    for (const [state, effects] of cases) {
      const next = transitionSidebarPeek(state, PEEK_DISABLED_EVENT)
      expect(next).toEqual({ status: "idle", attempt: 1 })
      expect(sidebarPeekEffects(state, next)).toEqual(effects)
    }

    expect(transitionSidebarPeek(INITIAL_SIDEBAR_PEEK_STATE, PEEK_DISABLED_EVENT)).toBe(INITIAL_SIDEBAR_PEEK_STATE)
  })

  test("re-aiming the pointer keeps the same state and reuses the same events", () => {
    const cases: [SidebarPeekState, SidebarPeekEvent[]][] = [
      [INITIAL_SIDEBAR_PEEK_STATE, [away, keep, toggleEnterEvent(false)]],
      [{ status: "dwelling", from: "edge", attempt: 1 }, [edge, samplePointerEvent(true, true)]],
      [{ status: "dwelling", from: "toggle", attempt: 1 }, [away, edge, toggleEnterEvent(true)]],
      [{ status: "peeking", attempt: 1 }, [keep, samplePointerEvent(true, true), toggleEnterEvent(true)]],
      [{ status: "grace", attempt: 2 }, [away, edge, toggleEnterEvent(false)]],
      [{ status: "leaving", attempt: 3, restoreFocus: false }, [away, keep]],
      [
        { status: "handing-off", attempt: 4 },
        [away, keep, edge, samplePointerEvent(true, true), toggleEnterEvent(true), PEEK_TOGGLE_LEAVE_EVENT],
      ],
    ]

    for (const [state, events] of cases) {
      for (const event of events) expect(transitionSidebarPeek(state, event)).toBe(state)
    }

    expect(samplePointerEvent(true, false)).toBe(edge)
    expect(Object.isFrozen(edge)).toBe(true)
    expect(toggleEnterEvent(true)).toBe(toggleEnterEvent(true))
    expect(sidebarPeekEffects(INITIAL_SIDEBAR_PEEK_STATE, INITIAL_SIDEBAR_PEEK_STATE)).toEqual([])
  })

  test("a toggle dwell ends when the pointer leaves the toggle, or a press interrupts it", () => {
    const dwelling = transitionSidebarPeek(INITIAL_SIDEBAR_PEEK_STATE, toggleEnterEvent(true))
    expect(dwelling).toEqual({ status: "dwelling", from: "toggle", attempt: 1 })
    expect(transitionSidebarPeek(dwelling, PEEK_TOGGLE_LEAVE_EVENT)).toEqual({ status: "idle", attempt: 1 })
    expect(transitionSidebarPeek(dwelling, PEEK_INTERRUPT_EVENT)).toEqual({ status: "idle", attempt: 1 })
    expect(transitionSidebarPeek(dwelling, { type: "dwell.elapsed", attempt: 1, ready: false })).toEqual({
      status: "idle",
      attempt: 1,
    })

    // The toggle takes over a pending edge dwell, on its own longer timer.
    const edgeDwell = transitionSidebarPeek(INITIAL_SIDEBAR_PEEK_STATE, edge)
    const toggleDwell = transitionSidebarPeek(edgeDwell, toggleEnterEvent(true))
    expect(sidebarPeekEffects(edgeDwell, toggleDwell)).toEqual([
      { type: "dwell.clear" },
      { type: "dwell.start", from: "toggle", attempt: 2, delayMs: 500 },
    ])
  })

  test("late timers, slides and docks from an earlier attempt are ignored", () => {
    // A cancelled edge dwell, then a new one.
    const redwell = replay([edge, away, edge]).state
    expect(transitionSidebarPeek(redwell, { type: "dwell.elapsed", attempt: 1, ready: true })).toBe(redwell)

    // A grace cancelled by the pointer's return, then a second grace.
    const regrace = replay([away, keep, away], peeking()).state
    expect(regrace).toEqual({ status: "grace", attempt: 3 })
    expect(transitionSidebarPeek(regrace, { type: "grace.elapsed", attempt: 2, keepOpen: false })).toBe(regrace)

    // A menu opened during the grace keeps the peek, and the next exit starts a fresh grace.
    const held = replay([away, { type: "grace.elapsed", attempt: 2, keepOpen: true }, away], peeking())
    expect(held.effects[1]).toEqual([{ type: "grace.clear" }])
    expect(held.state).toEqual({ status: "grace", attempt: 3 })

    // A slide out turned around at the edge, then closed again by Escape.
    const releave = replay([PEEK_ESCAPE_EVENT, edge, PEEK_ESCAPE_EVENT], peeking()).state
    expect(releave).toEqual({ status: "leaving", attempt: 4, restoreFocus: true })
    expect(transitionSidebarPeek(releave, { type: "leave.settled", attempt: 2 })).toBe(releave)

    // A dock reversed, peeked again, and docked again.
    const redock = replay(
      [PEEK_DOCK_OPENED_EVENT, PEEK_DOCK_CLOSED_EVENT, edge, PEEK_DOCK_OPENED_EVENT],
      peeking(),
    ).state

    expect(redock).toEqual({ status: "handing-off", attempt: 5 })
    expect(transitionSidebarPeek(redock, { type: "dock.settled", attempt: 2 })).toBe(redock)
  })

  test("only Escape returns focus to the toggle", () => {
    const grace = transitionSidebarPeek(peeking(), away)

    for (const state of [peeking(), grace]) {
      expect(transitionSidebarPeek(state, PEEK_ESCAPE_EVENT)).toMatchObject({ status: "leaving", restoreFocus: true })

      for (const event of [PEEK_BLUR_EVENT, PEEK_FOCUS_LEFT_EVENT, PEEK_DOCK_CLOSED_EVENT])
        expect(transitionSidebarPeek(state, event)).toMatchObject({ status: "leaving", restoreFocus: false })
    }

    expect(transitionSidebarPeek(grace, { type: "grace.elapsed", attempt: 2, keepOpen: false })).toMatchObject({
      status: "leaving",
      restoreFocus: false,
    })
  })

  test("disposing cleans up every phase and ignores what follows", () => {
    const states: SidebarPeekState[] = [
      INITIAL_SIDEBAR_PEEK_STATE,
      { status: "dwelling", from: "toggle", attempt: 1 },
      { status: "peeking", attempt: 1 },
      { status: "grace", attempt: 1 },
      { status: "leaving", attempt: 1, restoreFocus: true },
      { status: "handing-off", attempt: 1 },
    ]

    expect(states.map((state) => sidebarPeekEffects(state, transitionSidebarPeek(state, PEEK_DISPOSED_EVENT)))).toEqual(
      [
        [],
        [{ type: "dwell.clear" }],
        [{ type: "watch.stop" }, { type: "peek.reset" }],
        [{ type: "grace.clear" }, { type: "watch.stop" }, { type: "peek.reset" }],
        [{ type: "leave.clear" }, { type: "peek.reset" }],
        [{ type: "handoff.clear" }, { type: "peek.reset" }],
      ],
    )

    for (const event of [edge, toggleEnterEvent(true), PEEK_DOCK_OPENED_EVENT, PEEK_DISABLED_EVENT])
      expect(transitionSidebarPeek(DISPOSED_SIDEBAR_PEEK_STATE, event)).toBe(DISPOSED_SIDEBAR_PEEK_STATE)
  })
})
