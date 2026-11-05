import { describe, expect, test } from "bun:test"
import {
  createMotionState,
  MOTION_FOCUS_MS,
  selectMotionFeature,
  selectMotionHeld,
  selectMotionIdle,
  selectMotionPushed,
  transitionMotion,
  type MotionEffect,
  type MotionEvent,
  type MotionState,
} from "./motion-machine"

const narrow = () => createMotionState({ wide: false, selected: undefined })

const wide = () => createMotionState({ wide: true, selected: undefined })

const features = [{ key: "a" }, { key: "b" }]

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: MotionState, ...events: MotionEvent[]) {
  return events.reduce<{ state: MotionState; effects: readonly MotionEffect[] }>(
    (result, event) => {
      const next = transitionMotion(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("motion panel navigation", () => {
  test("a pushed feature that unregisters returns to the list instead of a blank page over an inert list", () => {
    const pushed = play(narrow(), { type: "feature.opened", key: "a" })

    expect(selectMotionPushed(pushed.state)).toBe(true)
    expect(pushed.effects).toEqual([{ type: "save" }, { type: "focus.page" }])

    const gone = play(pushed.state, { type: "features.changed", present: false })

    expect(selectMotionPushed(gone.state)).toBe(false)
    expect(gone.effects).toEqual([{ type: "focus.list" }])
    expect(play(pushed.state, { type: "features.changed", present: true }).state).toBe(pushed.state)
  })

  test("a feature opened wide does not push, so narrowing lands on the list", () => {
    const opened = play(wide(), { type: "feature.opened", key: "b" })

    expect(opened.effects).toEqual([{ type: "save" }])
    expect(selectMotionFeature(opened.state, features)).toEqual({ key: "b" })

    const narrowed = play(opened.state, { type: "resized", wide: false })

    expect(selectMotionPushed(narrowed.state)).toBe(false)
  })

  test("widening a pushed page drops the push, so narrowing again lands on the list", () => {
    const state = play(
      narrow(),
      { type: "feature.opened", key: "a" },
      { type: "resized", wide: true },
      { type: "resized", wide: false },
    ).state

    expect(selectMotionPushed(state)).toBe(false)
    expect(selectMotionFeature(state, features)).toEqual({ key: "a" })
  })

  test("the page keeps its feature while it slides back out, and wide falls back to the first", () => {
    const back = play(narrow(), { type: "feature.opened", key: "b" }, { type: "back" })

    expect(back.effects.at(-1)).toEqual({ type: "focus.row", key: "b" })
    expect(selectMotionFeature(back.state, features)).toEqual({ key: "b" })
    expect(selectMotionFeature(narrow(), features)).toBeUndefined()
    expect(selectMotionFeature(wide(), features)).toEqual({ key: "a" })
  })

  test("Escape pops a pushed page, and closes the panel from the list or wide", () => {
    const popped = play(narrow(), { type: "feature.opened", key: "a" }, { type: "escape" })

    expect(popped.effects.at(-1)).toEqual({ type: "focus.row", key: "a" })
    expect(play(popped.state, { type: "escape" }).effects).toEqual([{ type: "close" }])
    expect(play(wide(), { type: "feature.opened", key: "a" }, { type: "escape" }).effects.at(-1)).toEqual({
      type: "close",
    })
  })
})

describe("motion panel gestures", () => {
  test("one pointer holds one handle; others and non-primary buttons are ignored", () => {
    const held = play(narrow(), { type: "pointer.down", handle: "header", pointerId: 1, button: 0 }).state

    expect(selectMotionHeld(held, "header", 1)).toBe(true)
    expect(selectMotionHeld(held, "edge", 1)).toBe(false)
    expect(play(held, { type: "pointer.down", handle: "edge", pointerId: 2, button: 0 }).state).toBe(held)
    expect(play(narrow(), { type: "pointer.down", handle: "edge", pointerId: 1, button: 2 }).effects).toEqual([])
  })

  test("releasing settles once; a second release of the same pointer does nothing", () => {
    const held = play(narrow(), { type: "pointer.down", handle: "edge", pointerId: 1, button: 0 }).state
    const released = play(held, { type: "pointer.released", pointerId: 1 })

    expect(released.effects).toEqual([{ type: "settle" }])
    expect(selectMotionIdle(released.state)).toBe(true)
    expect(play(released.state, { type: "pointer.released", pointerId: 1 }).state).toBe(released.state)
    expect(play(held, { type: "pointer.released", pointerId: 7 }).state).toBe(held)
  })

  test("resizing within one side of the breakpoint keeps the same state object", () => {
    const state = wide()

    expect(transitionMotion(state, { type: "resized", wide: true }).state).toBe(state)
  })
})

describe("motion panel outline", () => {
  test("leaving a row keeps a Focus frame until it expires", () => {
    const focused = play(narrow(), { type: "target.focused", target: "#composer" })

    expect(focused.effects).toEqual([{ type: "outline.focus", target: "#composer", attempt: 1, delay: MOTION_FOCUS_MS }])
    expect(play(focused.state, { type: "row.left" }).state).toBe(focused.state)

    const expired = play(focused.state, { type: "outline.expired", attempt: 1 })

    expect(expired.effects).toEqual([{ type: "outline.frame", target: undefined }])
  })

  test("a newer Focus or a hover replaces the frame, and a stale expiry is ignored", () => {
    const twice = play(
      narrow(),
      { type: "target.focused", target: "#a" },
      { type: "target.focused", target: "#b" },
    ).state

    expect(play(twice, { type: "outline.expired", attempt: 1 }).state).toBe(twice)

    const hovered = play(twice, { type: "row.entered", target: "#c" })

    expect(hovered.effects).toEqual([{ type: "outline.frame", target: "#c" }])
    expect(play(hovered.state, { type: "outline.expired", attempt: 2 }).state).toBe(hovered.state)
    expect(play(hovered.state, { type: "row.left" }).effects).toEqual([{ type: "outline.frame", target: undefined }])
  })

  test("disposing removes the frames and ignores later events", () => {
    const disposed = play(narrow(), { type: "row.entered", target: "#a" }, { type: "disposed" })

    expect(disposed.effects.at(-1)).toEqual({ type: "outline.dispose" })
    expect(play(disposed.state, { type: "outline.expired", attempt: 1 }).effects).toEqual([])
  })
})
