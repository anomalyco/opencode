import { describe, expect, test } from "bun:test"
import {
  MODEL_CHIP_DEFER_TIMEOUT_MS,
  createModelChipState,
  selectModelChipPending,
  transitionModelChip,
  type ModelChipEffect,
  type ModelChipEvent,
  type ModelChipState,
} from "./model-chip-machine"

const click = (detail = 1, loading = true): Extract<ModelChipEvent, { type: "clicked" }> => ({
  type: "clicked",
  detail,
  loading,
  mobile: false,
  dialogOpen: false,
})

const loaded: ModelChipEvent = { type: "loaded", mobile: false, dialogOpen: false }

function run(events: ModelChipEvent[], state: ModelChipState = createModelChipState()) {
  return events.reduce(
    (acc, event) => {
      const next = transitionModelChip(acc.state, event)
      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state, effects: [] as ModelChipEffect[] },
  )
}

const opens = (effects: readonly ModelChipEffect[]) => effects.filter((effect) => effect.type === "open")

describe("model chip deferred open", () => {
  test("a click while loading waits for the catalog, then opens", () => {
    const deferred = transitionModelChip(createModelChipState(), click(1))
    expect(selectModelChipPending(deferred.state)).toBe(true)
    expect(deferred.effects).toEqual([{ type: "timer.start", attempt: 1, delayMs: MODEL_CHIP_DEFER_TIMEOUT_MS }])

    const next = transitionModelChip(deferred.state, loaded)
    expect(next.state).toEqual({ status: "idle", attempt: 1 })
    expect(next.effects).toEqual([{ type: "timer.clear" }, { type: "open", detail: 1 }])
  })

  test("a click after loading opens at once and keeps the state", () => {
    const state = createModelChipState()
    const next = transitionModelChip(state, click(0, false))
    expect(next.state).toBe(state)
    expect(next.effects).toEqual([{ type: "open", detail: 0 }])
  })

  // Each row replays a way the user moved on before the catalog loaded; the late load must not pop the dialog.
  test.each([
    ["cancelled", [click(), { type: "cancelled" }, loaded]],
    ["timed out", [click(), { type: "timed-out", attempt: 1 }, loaded]],
    ["a dialog opened", [click(), { type: "loaded", mobile: false, dialogOpen: true }]],
    ["switched to mobile", [click(), { type: "loaded", mobile: true, dialogOpen: false }]],
    ["clicked on mobile", [{ ...click(), mobile: true }, loaded]],
    ["clicked over a dialog", [{ ...click(), dialogOpen: true }, loaded]],
  ] satisfies [string, ModelChipEvent[]][])("%s: the late load opens nothing", (_, events) => {
    const result = run(events)
    expect(opens(result.effects)).toEqual([])
    expect(selectModelChipPending(result.state)).toBe(false)
  })

  test("a stale timer cannot cancel a later click", () => {
    const result = run([click(1), { type: "cancelled" }, click(0), { type: "timed-out", attempt: 1 }])
    expect(result.state).toEqual({ status: "deferred", attempt: 2, detail: 0 })

    const next = transitionModelChip(result.state, loaded)
    expect(next.effects).toEqual([{ type: "timer.clear" }, { type: "open", detail: 0 }])
  })

  test("a second click restarts the wait with the newer press", () => {
    const result = run([click(1), click(0)])
    expect(result.state).toEqual({ status: "deferred", attempt: 2, detail: 0 })
    expect(result.effects.at(-1)).toEqual({ type: "timer.start", attempt: 2, delayMs: MODEL_CHIP_DEFER_TIMEOUT_MS })
  })

  test("idle ignores loads, cancels and timers", () => {
    const state = createModelChipState()
    for (const event of [loaded, { type: "cancelled" }, { type: "timed-out", attempt: 0 }] satisfies ModelChipEvent[])
      expect(transitionModelChip(state, event)).toEqual({ state, effects: [] })
  })

  test("dispose clears a pending wait and ignores everything after", () => {
    const disposed = run([click(), { type: "disposed" }])
    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects.at(-1)).toEqual({ type: "timer.clear" })

    for (const event of [click(1, false), loaded, { type: "disposed" }] satisfies ModelChipEvent[])
      expect(transitionModelChip(disposed.state, event)).toEqual({ state: disposed.state, effects: [] })
  })
})
