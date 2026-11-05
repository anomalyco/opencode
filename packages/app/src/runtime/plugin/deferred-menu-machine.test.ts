import { describe, expect, test } from "bun:test"
import {
  createDeferredMenuState,
  DEFERRED_MENU_FALLBACK_MS,
  selectDeferredMenuOpen,
  transitionDeferredMenu,
  type DeferredMenuEffect,
  type DeferredMenuEvent,
  type DeferredMenuState,
} from "./deferred-menu-machine"

function run(events: DeferredMenuEvent<string>[], state: DeferredMenuState<string> = createDeferredMenuState()) {
  return events.reduce<{ state: DeferredMenuState<string>; effects: DeferredMenuEffect<string>[] }>(
    (current, event) => {
      const next = transitionDeferredMenu(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

// What Kobalte reports when the "+" asks to open, as `NewTabButton` dispatches it.
const press: DeferredMenuEvent<string> = { type: "open.change", open: true, available: true, defaultIntent: "new" }

const close: DeferredMenuEvent<string> = { type: "open.change", open: false, available: true, defaultIntent: "new" }

const ran = (effects: readonly DeferredMenuEffect<string>[]) =>
  effects.flatMap((effect) => (effect.type === "run.choice" ? [effect.choice] : []))

describe("deferred menu machine", () => {
  test.each([
    ["a modifier pressed alone", [{ type: "arm", intent: "menu" }, { type: "disarm" }]],
    ["a press dragged off the trigger", [{ type: "hover", hover: true }, { type: "arm", intent: "menu" }, { type: "hover", hover: false }]],
    ["a menu opened and closed", [{ type: "arm", intent: "menu" }, press, close]],
  ] satisfies [string, DeferredMenuEvent<string>[]][])("after %s, a plain activation opens a new tab", (_, events) => {
    const result = run([...events, press])

    expect(result.effects.at(-1)).toEqual({ type: "open.new-tab" })
    expect(selectDeferredMenuOpen(result.state)).toBe(false)
  })

  test("a press that asks for the menu opens it while it lists something", () => {
    expect(selectDeferredMenuOpen(run([{ type: "arm", intent: "menu" }, press]).state)).toBe(true)

    const empty = run([{ type: "arm", intent: "menu" }, { ...press, available: false }])

    expect(empty.effects).toEqual([{ type: "open.new-tab" }])
  })

  test("the menu stays shown after a choice until it reports its own close", () => {
    const chosen = run([{ type: "arm", intent: "menu" }, press, { type: "select", choice: "a" }])

    expect(selectDeferredMenuOpen(chosen.state)).toBe(true)
    expect(selectDeferredMenuOpen(run([close], chosen.state).state)).toBe(false)
  })

  test("a chosen item runs once focus returns", () => {
    const result = run([{ type: "arm", intent: "menu" }, press, { type: "select", choice: "a" }, close, { type: "close.autofocus" }])

    expect(result.effects).toEqual([
      { type: "timer.start", attempt: 1, delay: DEFERRED_MENU_FALLBACK_MS },
      { type: "timer.start", attempt: 1, delay: 0 },
    ])

    const fired = run([{ type: "timer.fired", attempt: 1 }, { type: "timer.fired", attempt: 1 }], result.state)

    expect(ran(fired.effects)).toEqual(["a"])
  })

  test("a chosen item still runs when focus never returns, and a later Escape runs nothing", () => {
    const chosen = run([{ type: "arm", intent: "menu" }, press, { type: "select", choice: "a" }, close])
    const fallback = run([{ type: "timer.fired", attempt: 1 }], chosen.state)

    expect(ran(fallback.effects)).toEqual(["a"])

    const escaped = run([{ type: "arm", intent: "menu" }, press, close, { type: "close.autofocus" }], fallback.state)

    expect(ran(escaped.effects)).toEqual([])
    expect(escaped.effects.filter((effect) => effect.type === "timer.start")).toEqual([])
  })

  test("reopening before the choice ran runs it at once", () => {
    const chosen = run([{ type: "arm", intent: "menu" }, press, { type: "select", choice: "a" }])
    const reopened = run([{ type: "context.menu", available: true }, { type: "timer.fired", attempt: 1 }], chosen.state)

    expect(reopened.effects).toEqual([{ type: "timer.stop" }, { type: "run.choice", choice: "a" }])
    expect(selectDeferredMenuOpen(reopened.state)).toBe(true)
  })

  test("disposal stops the timer and drops the choice", () => {
    const chosen = run([{ type: "arm", intent: "menu" }, press, { type: "select", choice: "a" }])
    const disposed = run([{ type: "disposed" }, { type: "timer.fired", attempt: 1 }], chosen.state)

    expect(disposed.effects).toEqual([{ type: "timer.stop" }])
    expect(disposed.state).toEqual({ status: "disposed" })
  })
})
