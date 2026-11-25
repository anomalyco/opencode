import { expect, test } from "bun:test"
import {
  DISPOSED,
  FOLLOWING,
  IDLE,
  PAUSED_IDLE,
  PAUSED_WORKING,
  createAutoScrollState,
  selectOverflowAnchor,
  selectPausesOnSelection,
  selectUserScrolled,
  transitionAutoScroll,
  type AutoScrollEffect,
  type AutoScrollEvent,
  type AutoScrollState,
} from "./auto-scroll-machine"

function run(state: AutoScrollState, ...events: AutoScrollEvent[]) {
  return events.reduce<{ state: AutoScrollState; effects: readonly AutoScrollEffect[] }>(
    (result, event) => transitionAutoScroll(result.state, event),
    { state, effects: [] },
  )
}

const types = (effects: readonly AutoScrollEffect[]) => effects.map((effect) => effect.type)

// Built the way `handleScroll` builds it from the viewport.
const scroll = (scrollTop: number, maxScroll: number, threshold = 10): AutoScrollEvent => ({
  type: "scroll",
  overflow: maxScroll > 1,
  scrollTop,
  maxScroll,
  threshold,
})

const flight = (top: number): AutoScrollEvent => ({ type: "flight.started", top })

test("a user scroll that lands on the last programmatic target pauses", () => {
  const consumed = run(FOLLOWING, flight(400), scroll(400, 400))
  expect(consumed.state).toBe(FOLLOWING)

  const later = transitionAutoScroll(consumed.state, scroll(400, 450))
  expect(later.state).toBe(PAUSED_WORKING)
  expect(types(later.effects)).toEqual(["notify.interacted"])

  const nudged = run(FOLLOWING, flight(400), scroll(398.8, 450))
  expect(nudged.state).toBe(PAUSED_WORKING)
  expect(types(nudged.effects)).toEqual(["notify.interacted"])
})

test("taking over drops the pending programmatic target", () => {
  const takeover = run(FOLLOWING, flight(400), { type: "pause", overflow: true })
  expect(takeover.state).toBe(PAUSED_WORKING)
  expect(takeover.state).not.toHaveProperty("flight")

  const resumed = run(takeover.state, scroll(445, 450), scroll(400, 450))
  expect(resumed.state).toBe(PAUSED_WORKING)
  expect(types(resumed.effects)).toEqual(["notify.interacted"])
})

test("content growth during a programmatic scroll catches up", () => {
  const result = run(FOLLOWING, flight(400), scroll(400, 460))
  expect(result.state).toBe(FOLLOWING)
  expect(types(result.effects)).toEqual(["pin.bottom"])
})

test("content that grows after the settling tail still follows", () => {
  const settling = transitionAutoScroll(FOLLOWING, { type: "working.changed", working: false, attempt: 1 })
  expect(settling.state).toEqual({ status: "settling", attempt: 1, detached: false, flight: undefined })
  expect(settling.effects).toEqual([{ type: "settle.start", attempt: 1 }])

  const idle = transitionAutoScroll(settling.state, { type: "settle.elapsed", attempt: 1 })
  expect(idle.state).toBe(IDLE)

  const grown = transitionAutoScroll(idle.state, { type: "resize", overflow: true })
  expect(grown.state).toBe(IDLE)
  expect(types(grown.effects)).toEqual(["pin.bottom"])
  expect(types(transitionAutoScroll(IDLE, { type: "scroll.bottom", force: false }).effects)).toEqual(["pin.bottom"])
})

test("pause ends as soon as the viewport stops overflowing", () => {
  expect(transitionAutoScroll(PAUSED_WORKING, { type: "resize", overflow: false }).state).toBe(FOLLOWING)
  expect(transitionAutoScroll(PAUSED_IDLE, { type: "resize", overflow: false }).state).toBe(IDLE)
  expect(transitionAutoScroll(PAUSED_WORKING, { type: "pause", overflow: false }).state).toBe(FOLLOWING)
  expect(transitionAutoScroll(FOLLOWING, { type: "pause", overflow: false }).state).toBe(FOLLOWING)
})

test("a viewport ref change keeps the pause until the new viewport measures", () => {
  const detached = transitionAutoScroll(PAUSED_IDLE, { type: "scroller.detached" }).state

  const remounted = run(
    detached,
    { type: "scroller.changed", overflow: false },
    { type: "scroller.changed", overflow: false },
  )

  expect(remounted.state).toBe(PAUSED_IDLE)
  expect(remounted.effects).toEqual([])

  expect(transitionAutoScroll(remounted.state, { type: "resize", overflow: false }).state).toBe(IDLE)
})

test("text selection pauses only while content still moves", () => {
  const settling = run(FOLLOWING, { type: "working.changed", working: false, attempt: 1 }).state

  expect(selectPausesOnSelection(FOLLOWING)).toBe(true)
  expect(selectPausesOnSelection(settling)).toBe(true)
  expect(selectPausesOnSelection(IDLE)).toBe(false)
  expect(selectPausesOnSelection(PAUSED_WORKING)).toBe(false)

  const paused = transitionAutoScroll(settling, { type: "pause", overflow: true })
  expect(paused.state).toBe(PAUSED_IDLE)
  expect(types(paused.effects)).toEqual(["settle.stop", "notify.interacted"])
})

test("a detached viewport keeps its pause and pins again on reattach", () => {
  const detached = transitionAutoScroll(PAUSED_WORKING, { type: "scroller.detached" }).state
  const measured = run(detached, { type: "resize", overflow: false }, scroll(0, 0))
  expect(measured.state).toBe(detached)

  const reattached = transitionAutoScroll(detached, { type: "scroller.reattached", overflow: true })
  expect(reattached.state).toBe(PAUSED_WORKING)
  expect(reattached.effects).toEqual([])

  const idle = run(IDLE, { type: "scroller.detached" }, { type: "scroller.reattached", overflow: true })
  expect(idle.state).toBe(IDLE)
  expect(types(idle.effects)).toEqual(["pin.bottom"])

  expect(transitionAutoScroll(IDLE, { type: "scroller.reattached", overflow: true }).effects).toEqual([])
})

test("detaching drops a programmatic target whose scroll event will not come", () => {
  const result = run(
    FOLLOWING,
    flight(400),
    { type: "scroller.detached" },
    { type: "scroller.reattached", overflow: true },
  )

  expect(result.state).toBe(FOLLOWING)

  expect(transitionAutoScroll(result.state, scroll(400, 450)).state).toBe(PAUSED_WORKING)
})

test("working resumes following from the settling tail and ignores stale settle timers", () => {
  const stopped = { type: "working.changed", working: false } as const
  const first = run(FOLLOWING, { ...stopped, attempt: 1 })
  const resumed = transitionAutoScroll(first.state, { type: "working.changed", working: true, attempt: 1 })
  expect(resumed.state).toBe(FOLLOWING)
  expect(types(resumed.effects)).toEqual(["settle.stop", "pin.bottom"])

  const second = transitionAutoScroll(resumed.state, { ...stopped, attempt: 2 }).state
  expect(transitionAutoScroll(second, { type: "settle.elapsed", attempt: 1 }).state).toBe(second)
  expect(transitionAutoScroll(second, { type: "settle.elapsed", attempt: 2 }).state).toBe(IDLE)
})

test("paused tracks work and a forced scroll resumes where work stands", () => {
  const idle = transitionAutoScroll(PAUSED_WORKING, { type: "working.changed", working: false, attempt: 1 })
  expect(idle.state).toBe(PAUSED_IDLE)
  expect(idle.effects).toEqual([])

  expect(transitionAutoScroll(PAUSED_IDLE, { type: "scroll.bottom", force: false }).state).toBe(PAUSED_IDLE)
  const forced = transitionAutoScroll(PAUSED_IDLE, { type: "scroll.bottom", force: true })
  expect(forced.state).toBe(IDLE)
  expect(types(forced.effects)).toEqual(["pin.bottom"])
  expect(transitionAutoScroll(PAUSED_WORKING, scroll(445, 450)).state).toBe(FOLLOWING)
})

test("steady scroll and resize return the same transition", () => {
  const steady: [AutoScrollState, AutoScrollEvent][] = [
    [IDLE, scroll(400, 400)],
    [FOLLOWING, scroll(400, 400)],
    [PAUSED_IDLE, scroll(100, 400)],
    [PAUSED_WORKING, scroll(100, 400)],
    [PAUSED_WORKING, { type: "resize", overflow: true }],
    [IDLE, { type: "resize", overflow: true }],
    [FOLLOWING, { type: "resize", overflow: true }],
  ]

  steady.forEach(([state, event]) => {
    const result = transitionAutoScroll(state, event)
    expect(result.state).toBe(state)
    expect(transitionAutoScroll(state, event)).toBe(result)
  })
})

test("disposal stops the settle timer and ignores later events", () => {
  const settling = run(FOLLOWING, { type: "working.changed", working: false, attempt: 1 }, flight(400)).state
  const disposed = transitionAutoScroll(settling, { type: "disposed" })
  expect(disposed.state).toBe(DISPOSED)
  expect(types(disposed.effects)).toEqual(["settle.stop"])

  const later = run(
    DISPOSED,
    { type: "working.changed", working: true, attempt: 2 },
    { type: "resize", overflow: true },
  )

  expect(later.state).toBe(DISPOSED)
  expect(later.effects).toEqual([])
})

test("selectors derive the public view", () => {
  expect(createAutoScrollState(true)).toBe(FOLLOWING)
  expect(createAutoScrollState(false)).toBe(IDLE)
  expect(selectUserScrolled(PAUSED_IDLE)).toBe(true)
  expect(selectUserScrolled(FOLLOWING)).toBe(false)
  expect(selectOverflowAnchor(PAUSED_IDLE)).toBe("auto")
  expect(selectOverflowAnchor(FOLLOWING)).toBe("none")
  expect(selectOverflowAnchor(PAUSED_IDLE, "none")).toBe("none")
  expect(selectOverflowAnchor(FOLLOWING, "auto")).toBe("auto")
})
