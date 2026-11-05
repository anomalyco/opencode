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

const toggle = (reduced = false): SourcesExpandEvent => ({ type: "toggle", expandable: true, reduced })

function replay(events: SourcesExpandEvent[], state = INITIAL_SOURCES_EXPAND_STATE) {
  return events.reduce<SourcesExpandState>((current, event) => transitionSourcesExpand(current, event), state)
}

describe("transitionSourcesExpand", () => {
  test("results that are missing or detached settle open instead of staying at zero height", () => {
    const opening = replay([toggle()])

    expect(opening).toEqual({ status: "opening", attempt: 1, mode: "height", reversed: false })
    expect(isSourcesStepOpen(opening)).toBe(true)

    const settled = transitionSourcesExpand(opening, { type: "detached", attempt: 1 })

    expect(settled).toEqual({ status: "open", attempt: 1 })
    expect(isSourcesStepMounted(settled)).toBe(true)
    expect(isSourcesStepMoving(settled)).toBe(false)
  })

  test("closing a reduced-motion fade cancels it, and its late rest does nothing", () => {
    const fading = replay([toggle(true)])

    expect(fading).toEqual({ status: "opening", attempt: 1, mode: "fade", reversed: false })

    const closed = transitionSourcesExpand(fading, toggle(true))

    expect(closed).toEqual({ status: "closed", attempt: 2 })
    expect(isSourcesStepMounted(closed)).toBe(false)
    expect(transitionSourcesExpand(closed, { type: "settled", attempt: 1 })).toBe(closed)

    // Opening again starts a new fade with its own attempt; the old one's rest is stale.
    const reopened = transitionSourcesExpand(closed, toggle(true))

    expect(reopened).toMatchObject({ status: "opening", attempt: 3 })
    expect(transitionSourcesExpand(reopened, { type: "settled", attempt: 1 })).toBe(reopened)
    expect(transitionSourcesExpand(reopened, { type: "settled", attempt: 3 })).toEqual({ status: "open", attempt: 3 })
  })

  test("reversing a height flight mid-way keeps the spring, a flight from rest measures again", () => {
    const closing = replay([toggle(), toggle()])

    expect(closing).toEqual({ status: "closing", attempt: 2, mode: "height", reversed: true })
    expect(transitionSourcesExpand(closing, toggle())).toEqual({
      status: "opening",
      attempt: 3,
      mode: "height",
      reversed: true,
    })
    expect(transitionSourcesExpand(closing, { type: "settled", attempt: 1 })).toBe(closing)

    const closed = transitionSourcesExpand(closing, { type: "settled", attempt: 2 })

    expect(closed).toEqual({ status: "closed", attempt: 2 })
    expect(replay([toggle(), { type: "settled", attempt: 1 }, toggle()])).toEqual({
      status: "closing",
      attempt: 2,
      mode: "height",
      reversed: false,
    })
    // A fade has no height to reverse.
    expect(replay([toggle(true), toggle()])).toMatchObject({ status: "closing", reversed: false })
  })

  test("never changes the state it is given", () => {
    const states = [
      INITIAL_SOURCES_EXPAND_STATE,
      replay([toggle()]),
      replay([toggle(), toggle()]),
      replay([toggle(true)]),
      { status: "open", attempt: 4 } as const,
    ]
    const events: SourcesExpandEvent[] = [
      toggle(),
      toggle(true),
      { type: "settled", attempt: 1 },
      { type: "detached", attempt: 2 },
      REDUCED_SOURCES_EXPAND_EVENT,
      COLLAPSE_SOURCES_EXPAND_EVENT,
      DISPOSED_SOURCES_EXPAND_EVENT,
    ]

    for (const state of states) {
      const frozen = Object.freeze({ ...state })

      // A write to the frozen copy throws in a module, so any in-place change fails here.
      for (const event of events) {
        transitionSourcesExpand(frozen, event)

        expect(frozen).toEqual(state)
      }
    }
  })

  test("collapse, reduced motion and dispose end any flight", () => {
    const opening = replay([toggle()])
    const closing = replay([toggle()], { status: "open", attempt: 0 })

    expect(transitionSourcesExpand(opening, COLLAPSE_SOURCES_EXPAND_EVENT)).toEqual({ status: "closed", attempt: 2 })
    expect(transitionSourcesExpand(opening, REDUCED_SOURCES_EXPAND_EVENT)).toEqual({ status: "open", attempt: 1 })
    expect(transitionSourcesExpand(closing, REDUCED_SOURCES_EXPAND_EVENT).status).toBe("closed")

    const disposed = transitionSourcesExpand(opening, DISPOSED_SOURCES_EXPAND_EVENT)

    expect(disposed.status).toBe("disposed")
    expect(transitionSourcesExpand(disposed, toggle())).toBe(disposed)
  })

  test("a step without results ignores a toggle while closed", () => {
    const closed = INITIAL_SOURCES_EXPAND_STATE

    expect(transitionSourcesExpand(closed, { type: "toggle", expandable: false, reduced: false })).toBe(closed)
    expect(transitionSourcesExpand(closed, COLLAPSE_SOURCES_EXPAND_EVENT)).toBe(closed)
    expect(transitionSourcesExpand(closed, { type: "settled", attempt: 0 })).toBe(closed)
  })
})
