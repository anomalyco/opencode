import { describe, expect, test } from "bun:test"
import {
  COLLAPSE_SOURCES_EXPAND_EVENT,
  DISPOSED_SOURCES_EXPAND_EVENT,
  INITIAL_SOURCES_EXPAND_STATE,
  isSourcesStepMounted,
  isSourcesStepMoving,
  isSourcesStepOpen,
  REDUCED_SOURCES_EXPAND_EVENT,
  transitionSourcesExpand,
  type SourcesExpandEvent,
  type SourcesExpandState,
} from "./sources-expand-machine"

const curve = { duration: 0.35, bounce: 0 }
const toggle = (reduced = false): SourcesExpandEvent => ({ type: "toggle", expandable: true, reduced, curve })

function replay(events: SourcesExpandEvent[], state = INITIAL_SOURCES_EXPAND_STATE) {
  return events.reduce<SourcesExpandState>((current, event) => transitionSourcesExpand(current, event), state)
}

function moving(state: SourcesExpandState) {
  if (!isSourcesStepMoving(state)) throw new Error(`expected a moving state, got ${state.status}`)

  return state
}

describe("transitionSourcesExpand", () => {
  test("results that are missing or detached settle open instead of staying at zero height", () => {
    const opening = moving(replay([toggle()]))

    expect(isSourcesStepOpen(opening)).toBe(true)

    const settled = transitionSourcesExpand(opening, { type: "detached", attempt: opening.attempt })

    expect(settled).toEqual({ status: "open", attempt: 1 })
    expect(isSourcesStepMounted(settled)).toBe(true)
    expect(isSourcesStepMoving(settled)).toBe(false)
  })

  test("closing a reduced-motion fade cancels it, and its late frames do nothing", () => {
    const fading = moving(replay([toggle(true)]))

    expect(fading).toMatchObject({ status: "opening", mode: "fade", measured: true, value: 0 })

    const closed = transitionSourcesExpand(fading, toggle(true))

    expect(closed).toEqual({ status: "closed", attempt: 2 })
    expect(isSourcesStepMounted(closed)).toBe(false)
    expect(transitionSourcesExpand(closed, { type: "frame", attempt: fading.attempt, dt: 1 / 60 })).toBe(closed)

    // Opening again starts a new fade with its own attempt; the old one's frames are stale.
    const reopened = moving(transitionSourcesExpand(closed, toggle(true)))

    expect(reopened.attempt).toBe(3)
    expect(transitionSourcesExpand(reopened, { type: "frame", attempt: fading.attempt, dt: 1 / 60 })).toBe(reopened)
  })

  test("a flight steps in place and lands at rest", () => {
    const opening = moving(replay([toggle()]))
    const measured = moving(transitionSourcesExpand(opening, { type: "measured", attempt: 1, from: 0, to: 120 }))

    expect(measured).toBe(opening)

    const frame = { type: "frame" as const, attempt: 1, dt: 1 / 60 }
    const step = (state: SourcesExpandState) => transitionSourcesExpand(state, frame)
    const first = step(measured)

    expect(first).toBe(measured)
    expect(measured.value).toBeGreaterThan(0)

    const landed = Array.from({ length: 120 }).reduce<SourcesExpandState>((state) => step(state), first)

    expect(landed).toEqual({ status: "open", attempt: 1 })
  })

  test("reversing mid-flight keeps the spring's velocity", () => {
    const opening = moving(replay([toggle(), { type: "measured", attempt: 1, from: 0, to: 120 }]))
    transitionSourcesExpand(opening, { type: "frame", attempt: 1, dt: 0.08 })
    const velocity = opening.spring.velocity

    expect(velocity).toBeGreaterThan(0)

    const closing = moving(transitionSourcesExpand(opening, toggle()))

    expect(closing).toMatchObject({ status: "closing", attempt: 1, fromRest: false, measured: true })
    expect(closing.spring.velocity).toBe(velocity)
    expect(closing.spring.target).toBe(0)

    const value = closing.spring.value
    const reopened = moving(transitionSourcesExpand(closing, toggle()))

    expect(reopened).toMatchObject({ status: "opening", attempt: 1, fromRest: false, measured: false })

    transitionSourcesExpand(reopened, { type: "measured", attempt: 1, from: 0, to: 140 })

    expect(reopened.spring.value).toBe(value)
    expect(reopened.spring.velocity).toBe(velocity)
    expect(reopened.spring.target).toBe(140)
  })

  test("collapse, reduced motion and dispose end any flight", () => {
    const opening = moving(replay([toggle(), { type: "measured", attempt: 1, from: 0, to: 120 }]))
    const closing = moving(
      replay([toggle(), { type: "measured", attempt: 1, from: 120, to: 0 }], { status: "open", attempt: 0 }),
    )

    expect(transitionSourcesExpand(opening, COLLAPSE_SOURCES_EXPAND_EVENT)).toEqual({ status: "closed", attempt: 2 })
    expect(transitionSourcesExpand(opening, REDUCED_SOURCES_EXPAND_EVENT)).toEqual({ status: "open", attempt: 1 })
    expect(transitionSourcesExpand(closing, REDUCED_SOURCES_EXPAND_EVENT).status).toBe("closed")

    const disposed = transitionSourcesExpand(opening, DISPOSED_SOURCES_EXPAND_EVENT)

    expect(disposed.status).toBe("disposed")
    expect(transitionSourcesExpand(disposed, toggle())).toBe(disposed)
  })

  test("a step without results ignores a toggle while closed", () => {
    const closed = INITIAL_SOURCES_EXPAND_STATE

    expect(transitionSourcesExpand(closed, { type: "toggle", expandable: false, reduced: false, curve })).toBe(closed)
    expect(transitionSourcesExpand(closed, COLLAPSE_SOURCES_EXPAND_EVENT)).toBe(closed)
  })
})
