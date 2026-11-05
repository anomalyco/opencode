import { describe, expect, test } from "bun:test"
import {
  createSelectHighlightState,
  transitionSelectHighlight,
  type SelectHighlightEvent,
  type SelectHighlightState,
  type SelectHighlightTransition,
} from "./machine"

const OPEN: SelectHighlightEvent = { type: "open.changed", open: true }
const CLOSE: SelectHighlightEvent = { type: "open.changed", open: false }
const highlight = (key: string): SelectHighlightEvent => ({ type: "highlight.changed", key, previewable: true })

const select = (key: string | undefined, closing = true): SelectHighlightEvent => ({
  type: "option.selected",
  key,
  closing,
})

function run(state: SelectHighlightState, ...events: SelectHighlightEvent[]) {
  return events.reduce<SelectHighlightTransition[]>(
    (steps, event) => [...steps, transitionSelectHighlight(steps.at(-1)?.state ?? state, event)],
    [],
  )
}

const effects = (steps: SelectHighlightTransition[]) => steps.map((step) => step.effects.map((effect) => effect.type))

describe("select highlight preview", () => {
  test("choosing the previewed option keeps its preview through the close", () => {
    // Before: onChange ran the highlighted option's undo after onSelect had committed it.
    const steps = run(createSelectHighlightState(false), OPEN, highlight("b"), select("b"), CLOSE)

    expect(steps[1]!.effects).toEqual([{ type: "preview.apply", key: "b" }])
    expect(effects(steps).slice(2)).toEqual([[], []])
    expect(steps.at(-1)!.state).toEqual({ status: "closed" })
  })

  test("choosing another option, or clearing, reverts the preview before the caller commits", () => {
    for (const key of ["b", undefined]) {
      const steps = run(createSelectHighlightState(false), OPEN, highlight("a"), select(key), CLOSE)

      expect(effects(steps).slice(2)).toEqual([["preview.revert"], []])
      expect(steps.at(-1)!.state).toEqual({ status: "closed" })
    }
  })

  test("items that highlight while the menu is closing or closed preview nothing, and a reopen previews again", () => {
    // Before: a focus or pointer event during the exit animation applied a preview nothing ever reverted.
    const committed = run(createSelectHighlightState(false), OPEN, highlight("a"), select("a")).at(-1)!.state
    const late = transitionSelectHighlight(committed, highlight("c"))

    expect(late.state).toBe(committed)
    expect(late.effects).toEqual([])
    const closed = transitionSelectHighlight(committed, CLOSE).state
    expect(transitionSelectHighlight(closed, highlight("c")).state).toBe(closed)

    const steps = run(closed, OPEN, highlight("c"), CLOSE)
    expect(steps[1]!.effects).toEqual([{ type: "preview.apply", key: "c" }])
    expect(effects(steps)[2]).toEqual(["preview.revert"])
  })

  test("a controlled close reverts the preview", () => {
    // Before: a parent setting open={false} fired no onOpenChange, so the preview stayed applied while closed.
    const steps = run(createSelectHighlightState(true), highlight("a"), CLOSE)

    expect(effects(steps)).toEqual([["preview.apply"], ["preview.revert"]])
  })

  test("moving between options reverts the previous preview first, and the same option does nothing", () => {
    const steps = run(createSelectHighlightState(true), highlight("a"), highlight("a"), highlight("b"))

    expect(steps[1]!.state).toBe(steps[0]!.state)
    expect(steps[2]!.effects).toEqual([{ type: "preview.revert" }, { type: "preview.apply", key: "b" }])
  })

  test("a select without onHighlight previews nothing and drops a preview it had", () => {
    const off: SelectHighlightEvent = { type: "highlight.changed", key: "a", previewable: false }
    const idle = createSelectHighlightState(true)

    expect(transitionSelectHighlight(idle, off).state).toBe(idle)
    expect(effects(run(idle, highlight("b"), off))[1]).toEqual(["preview.revert"])
  })

  test("a choice that keeps the menu open keeps previewing", () => {
    const steps = run(createSelectHighlightState(true), highlight("a"), select("a", false), highlight("b"))

    expect(steps[1]!.state).toEqual({ status: "idle" })
    expect(steps[1]!.effects).toEqual([])
    expect(steps[2]!.effects).toEqual([{ type: "preview.apply", key: "b" }])
  })

  test("disposal reverts an active preview and ignores everything after", () => {
    const steps = run(createSelectHighlightState(true), highlight("a"), { type: "disposed" })

    expect(effects(steps)[1]).toEqual(["preview.revert"])
    const disposed = steps[1]!.state
    expect(transitionSelectHighlight(disposed, OPEN).state).toBe(disposed)
    expect(transitionSelectHighlight(disposed, highlight("b")).effects).toEqual([])
    expect(transitionSelectHighlight(createSelectHighlightState(false), { type: "disposed" }).effects).toEqual([])
  })
})
