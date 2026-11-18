import { describe, expect, test } from "bun:test"
import {
  INITIAL_TAB_HINTS_STATE,
  selectTabHintsShown,
  TAB_HINTS_DELAY_MS,
  transitionTabHints,
  type TabHintsEffect,
  type TabHintsEvent,
  type TabHintsState,
} from "./tab-hints-machine"

const replay = (events: TabHintsEvent[], state: TabHintsState = INITIAL_TAB_HINTS_STATE) =>
  events.reduce<{ state: TabHintsState; effects: TabHintsEffect[] }>(
    (current, event) => {
      const next = transitionTabHints(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )

const press = (key: "mod" | "digit" | "other", extra = false): TabHintsEvent => ({
  type: "key.down",
  key,
  mod: true,
  extra,
})

const release: TabHintsEvent = { type: "modifiers", mod: false, extra: false }

const elapsed = (attempt: number): TabHintsEvent => ({ type: "delay.elapsed", attempt })

describe("tab hints", () => {
  test("holding the mod key alone shows the numbers after the delay, and releasing it hides them", () => {
    const pending = replay([press("mod")])

    expect(pending.effects).toEqual([{ type: "delay.start", attempt: 1, delayMs: TAB_HINTS_DELAY_MS }])
    expect(selectTabHintsShown(pending.state)).toBe(false)

    const shown = replay([elapsed(1)], pending.state)

    expect(selectTabHintsShown(shown.state)).toBe(true)
    expect(selectTabHintsShown(replay([release], shown.state).state)).toBe(false)
  })

  test("a shortcut pressed before the delay cancels it, so a quick ⌘C never shows numbers", () => {
    const result = replay([press("mod"), press("other"), elapsed(1)])

    expect(result.effects).toEqual([
      { type: "delay.start", attempt: 1, delayMs: TAB_HINTS_DELAY_MS },
      { type: "delay.clear" },
    ])
    expect(selectTabHintsShown(result.state)).toBe(false)
  })

  test("digits keep the numbers up while picking tabs, and another key hides them", () => {
    const shown = replay([press("mod"), elapsed(1), press("digit"), { type: "modifiers", mod: true, extra: false }])

    expect(selectTabHintsShown(shown.state)).toBe(true)
    expect(selectTabHintsShown(replay([press("other")], shown.state).state)).toBe(false)
  })

  test("a digit pressed during the delay cancels it", () => {
    expect(selectTabHintsShown(replay([press("mod"), press("digit"), elapsed(1)]).state)).toBe(false)
  })

  test("another modifier joining in cancels the hints", () => {
    expect(selectTabHintsShown(replay([press("mod"), press("other", true), elapsed(1)]).state)).toBe(false)
    expect(
      selectTabHintsShown(replay([press("mod"), elapsed(1), { type: "modifiers", mod: true, extra: true }]).state),
    ).toBe(false)
  })

  test("leaving the window or unmounting cancels a pending delay", () => {
    for (const exit of [{ type: "window.left" }, { type: "disposed" }] as const) {
      const result = replay([press("mod"), exit, elapsed(1)])

      expect(result.effects.at(-1)).toEqual({ type: "delay.clear" })
      expect(selectTabHintsShown(result.state)).toBe(false)
    }
  })

  test("a stale delay from an earlier hold does not show the numbers during a later one", () => {
    const result = replay([press("mod"), release, press("mod"), elapsed(1)])

    expect(selectTabHintsShown(result.state)).toBe(false)
    expect(selectTabHintsShown(replay([elapsed(2)], result.state).state)).toBe(true)
  })

  test("a repeated mod keydown keeps the original delay", () => {
    const pending = replay([press("mod")]).state
    const next = transitionTabHints(pending, press("mod"))

    expect(next.state).toBe(pending)
    expect(next.effects).toEqual([])
  })
})
