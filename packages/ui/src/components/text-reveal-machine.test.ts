import { describe, expect, test } from "bun:test"
import {
  createTextRevealState,
  selectTextRevealEntering,
  selectTextRevealLeaving,
  selectTextRevealReady,
  selectTextRevealSwapping,
  selectTextRevealTrackWidth,
  transitionTextReveal,
  type TextRevealEvent,
  type TextRevealState,
  type TextRevealTransition,
} from "./text-reveal-machine"

function run(state: TextRevealState, ...events: TextRevealEvent[]) {
  return events.reduce<TextRevealTransition>((result, event) => transitionTextReveal(result.state, event), {
    state,
    effects: [],
  })
}

const measured = (widthPx: number, growOnly = true) => ({ widthPx, growOnly })

const settled = (text: string) =>
  run(
    createTextRevealState(text),
    { type: "fonts.settled", ...measured(40) },
    { type: "ready.settled", ...measured(40) },
  ).state

describe("transitionTextReveal", () => {
  test("mounting with text does not swap", () => {
    const state = createTextRevealState("Thinking")
    const result = transitionTextReveal(state, { type: "text.changed", text: "Thinking" })

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([])
  })

  test("waits for fonts and one frame before turning transitions on", () => {
    const fonts = run(createTextRevealState("Thinking"), { type: "fonts.settled", ...measured(40) })

    expect(selectTextRevealReady(fonts.state)).toBe(false)
    expect(fonts.effects).toEqual([{ type: "ready.frame" }])

    const ready = transitionTextReveal(fonts.state, { type: "ready.settled", ...measured(42) })

    expect(ready.state).toMatchObject({ status: "idle", current: "Thinking", widthPx: 42 })
    expect(selectTextRevealReady(ready.state)).toBe(true)
    expect(ready.effects).toEqual([{ type: "cancel.frame" }, { type: "cancel.ready-timer" }])
  })

  test("a change before the first paint replaces the text without a swap", () => {
    const result = transitionTextReveal(createTextRevealState("A"), { type: "text.changed", text: "B" })

    expect(result.state).toMatchObject({ status: "measuring", current: "B" })
    expect(selectTextRevealSwapping(result.state)).toBe(false)
    expect(selectTextRevealLeaving(result.state)).toBe("\u00A0")
    expect(result.effects).toEqual([{ type: "measure.entering" }])
  })

  test("fonts that never settle time out into ready and ignore the late results", () => {
    const timedOut = run(createTextRevealState("A"), { type: "ready.timed-out", ...measured(30) })

    expect(timedOut.state).toMatchObject({ status: "idle", widthPx: 30 })
    expect(run(timedOut.state, { type: "ready.settled", ...measured(50) }).state).toBe(timedOut.state)
  })

  test("fonts that settle after the timeout re-measure the width without a frame", () => {
    const timedOut = run(createTextRevealState("A"), { type: "ready.timed-out", ...measured(30) }).state
    const late = transitionTextReveal(timedOut, { type: "fonts.settled", ...measured(50) })

    expect(late.state).toMatchObject({ status: "idle", widthPx: 50 })
    expect(late.effects).toEqual([])
    expect(transitionTextReveal(late.state, { type: "fonts.settled", ...measured(50) }).state).toBe(late.state)

    const swapping = transitionTextReveal(timedOut, { type: "text.changed", text: "B" }).state

    expect(transitionTextReveal(swapping, { type: "fonts.settled", ...measured(60) }).state).toMatchObject({
      status: "swapping",
      widthPx: 60,
    })
  })

  test("swaps a replaced text and wipes it out after one frame", () => {
    const swap = transitionTextReveal(settled("Alpha"), { type: "text.changed", text: "Beta" })

    expect(swap.state).toMatchObject({ status: "swapping", attempt: 1, current: "Beta", leaving: "Alpha" })
    expect(swap.effects).toEqual([{ type: "swap.frame", attempt: 1 }])

    const done = transitionTextReveal(swap.state, { type: "swap.settled", attempt: 1, ...measured(60) })

    expect(done.state).toMatchObject({ status: "idle", current: "Beta", leaving: "Alpha", widthPx: 60 })
  })

  test("two changes in one frame wipe out the text that was on screen", () => {
    const result = run(
      settled("Alpha"),
      { type: "text.changed", text: "Beta" },
      { type: "text.changed", text: "Gamma" },
    )

    expect(result.state).toMatchObject({ status: "swapping", attempt: 2, current: "Gamma", leaving: "Alpha" })
    expect(result.effects).toEqual([{ type: "cancel.frame" }, { type: "swap.frame", attempt: 2 }])
    expect(run(result.state, { type: "swap.settled", attempt: 1, ...measured(80) }).state).toBe(result.state)
    expect(selectTextRevealLeaving(result.state)).toBe("Alpha")
  })

  test("changing back within one frame cancels the swap", () => {
    const result = run(
      settled("Alpha"),
      { type: "text.changed", text: "Beta" },
      { type: "text.changed", text: "Alpha" },
    )

    expect(result.state).toMatchObject({ status: "idle", current: "Alpha", leaving: undefined })
    expect(result.effects).toEqual([{ type: "cancel.frame" }, { type: "measure.entering" }])

    const next = transitionTextReveal(result.state, { type: "text.changed", text: "Gamma" })

    expect(next.state).toMatchObject({ status: "swapping", attempt: 2, leaving: "Alpha" })
  })

  test("extending the text grows it in place", () => {
    const result = transitionTextReveal(settled("Plan"), { type: "text.changed", text: "Planning" })

    expect(result.state).toMatchObject({ status: "idle", current: "Planning" })
    expect(result.effects).toEqual([{ type: "measure.entering" }])
    expect(selectTextRevealEntering(result.state)).toBe("Planning")
  })

  test("grows only when asked, and ignores empty measurements", () => {
    const state = settled("Alpha")

    expect(transitionTextReveal(state, { type: "width.measured", ...measured(20) }).state).toBe(state)
    expect(transitionTextReveal(state, { type: "width.measured", ...measured(0, false) }).state).toBe(state)
    expect(transitionTextReveal(state, { type: "width.measured", ...measured(20, false) }).state).toMatchObject({
      widthPx: 20,
    })
    expect(selectTextRevealTrackWidth(state, false)).toBe("40px")
    expect(selectTextRevealTrackWidth(state, true)).toBe("100%")
    expect(selectTextRevealTrackWidth(createTextRevealState("A"), false)).toBe("auto")
  })

  test("disposing cancels pending work and ignores late results", () => {
    const measuring = transitionTextReveal(createTextRevealState("A"), { type: "disposed" })

    expect(measuring.effects).toEqual([{ type: "cancel.frame" }, { type: "cancel.ready-timer" }])
    expect(run(measuring.state, { type: "ready.timed-out", ...measured(10) }).state).toBe(measuring.state)

    const swapping = run(settled("Alpha"), { type: "text.changed", text: "Beta" }, { type: "disposed" })

    expect(swapping.state).toEqual({ status: "disposed" })
    expect(swapping.effects).toEqual([{ type: "cancel.frame" }])
    expect(run(swapping.state, { type: "swap.settled", attempt: 1, ...measured(10) }).state).toBe(swapping.state)
  })
})
