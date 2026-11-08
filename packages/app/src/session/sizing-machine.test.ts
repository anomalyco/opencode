import { describe, expect, test } from "bun:test"
import {
  SIZING_SETTLE_MS,
  createSizingState,
  isSizingActive,
  transitionSizing,
  type SizingEvent,
  type SizingState,
  type SizingTransition,
} from "./sizing-machine"

function replay(events: SizingEvent[], from: SizingState = createSizingState()) {
  return events.reduce<SizingTransition[]>((steps, event) => {
    steps.push(transitionSizing(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

describe("transitionSizing", () => {
  test("stays sizing through a drag that pauses longer than the settle delay", () => {
    const steps = replay([
      { type: "pointer.down" },
      { type: "resize.touched" },
      { type: "settle.due", attempt: 1 },
      { type: "settle.due", attempt: 0 },
    ])

    expect(steps.map((step) => step.state.status)).toEqual(["dragging", "dragging", "dragging", "dragging"])
    expect(steps.every((step) => step.effects.length === 0)).toBe(true)
    expect(isSizingActive(steps.at(-1)!.state)).toBe(true)
    expect(transitionSizing(steps.at(-1)!.state, { type: "pointer.up" }).state).toEqual({ status: "idle", attempt: 0 })
  })

  test("returns the same state for every move of a held drag", () => {
    const dragging = transitionSizing(createSizingState(), { type: "pointer.down" }).state
    const next = transitionSizing(dragging, { type: "resize.touched" })

    expect(next.state).toBe(dragging)
    expect(next.effects).toEqual([])
  })

  test("settles a resize without a held pointer after the latest touch only", () => {
    const steps = replay([
      { type: "resize.touched" },
      { type: "resize.touched" },
      { type: "settle.due", attempt: 1 },
      { type: "settle.due", attempt: 2 },
    ])

    expect(steps.map((step) => step.state)).toEqual([
      { status: "settling", attempt: 1 },
      { status: "settling", attempt: 2 },
      { status: "settling", attempt: 2 },
      { status: "idle", attempt: 2 },
    ])
    expect(steps[1]!.effects).toEqual([{ type: "schedule-settle", attempt: 2, delayMs: SIZING_SETTLE_MS }])
  })

  test("ignores a settle timer from before a drag", () => {
    const steps = replay([
      { type: "resize.touched" },
      { type: "pointer.down" },
      { type: "pointer.up" },
      { type: "resize.touched" },
      { type: "settle.due", attempt: 1 },
    ])

    expect(steps[1]!.effects).toEqual([{ type: "cancel-settle" }])
    expect(steps.at(-1)!.state).toEqual({ status: "settling", attempt: 2 })
  })

  test("resets a drag and a pending settle to idle", () => {
    const dragging = transitionSizing(createSizingState(), { type: "pointer.down" }).state
    const settling = transitionSizing(createSizingState(), { type: "resize.touched" }).state
    const idle = createSizingState()

    expect(transitionSizing(dragging, { type: "reset" })).toEqual({
      state: { status: "idle", attempt: 0 },
      effects: [],
    })
    expect(transitionSizing(settling, { type: "reset" })).toEqual({
      state: { status: "idle", attempt: 1 },
      effects: [{ type: "cancel-settle" }],
    })
    expect(transitionSizing(idle, { type: "reset" }).state).toBe(idle)
    expect(transitionSizing(idle, { type: "pointer.up" }).state).toBe(idle)
  })
})
